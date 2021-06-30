const ethers = require("ethers");
const fs = require("fs");
const fsPromise = fs.promises;

const threshold = 5;
let finalizeBlkC;
let finalizeBlkH;

let finishTaskC = 0;
let finishTaskH = 0;

let kv_ctxc = {};
let kv_heco = {};

// there are 4 state of each task from for each bridge side, when state is in the finish state
// we drop it
// pending task is request that are get from the onchain event emitter
kv_ctxc.pendingTask = [];
kv_heco.pendingTask = [];

kv_ctxc.processingTask = [];
kv_heco.processingTask = [];

kv_ctxc.finalizeTask = [];
kv_heco.finalizeTask = [];

// some config params
// local: run on ethereumjs vm
// test: run on test network(e.g. heco test network, kovan ..)
const modes = ["local", "test", "main"];
let mode = modes[0];

async function getContractInstance(name, signer) {
    let artifactPath =
        "./artifacts/contracts/" + name + ".sol/" + name + ".json";
    console.log("path for ", name, "is: ", artifactPath);
    let addrPath = "./addr.json";

    let data = await fsPromise.readFile(artifactPath);
    data = JSON.parse(data);

    let addr = await fsPromise.readFile(addrPath);
    addr = JSON.parse(addr);
    addr = addr[mode];
    return new ethers.Contract(addr[name], data.abi, signer);
}

// restore operator Node state by the blockchain data
// use when restart the operator due to some faults, before the
// restore finish, we should pause the bridge.
async function restoreFromChain(bridgeCtxc, bridgeHeco) {
    // operation in (..., finalizeBlkC] is verified, no need to check.
    // operation in (finalizeBlk, currentBlk] is require to process to restore the node state due to
    // we have no idea which operation is finished(could be optimzie with redis as the cache).

    finalizeBlkC = (await bridgeCtxc.checkPoint()).toNumber();
    let fromBlkC = finalizeBlkC + 1;

    let suspensiveTasksC = await bridgeCtxc.queryFilter(
        "Deposit",
        fromBlkC,
        "latest"
    );

    // we should handle all the request tasks, once it has completed, we restore from chain successfully.
    suspensiveTasksC.forEach(async (task, index, arr) => {
        let operationFilter = bridgeHeco.filters.WithdrawToken(
            null,
            task.transactionHash
        );
        let operation = await bridgeHeco.queryFilter(operationFilter);

        if (operation.length == 1) {
            // if we found the operation in another chain,we have excute this operation,
            // it should be delete from the suspensiveTask.
            arr.splice(index, 1);
        } else if (operation.length > 1) {
            // if operation more than 1, it show that fault lead to excute the operation more than ocne.
            console.error("the operation excuted more than once: ", task);
            process.exit(2);
        }
    });
    //now the task still in the suspensiveTasks is operation need to be excuted.
    kv_ctxc.pendingTask = suspensiveTasksC;

    finalizeBlkH = (await bridgeHeco.checkPoint()).toNumber();
    let fromBlkH = finalizeBlkH + 1;

    let suspensiveTasksH = await bridgeHeco.queryFilter(
        "DepositToken",
        fromBlkH,
        "latest"
    );

    suspensiveTasksH.forEach(async (task, index, arr) => {
        let operationFilter = bridgeCtxc.filters.Withdraw(
            null,
            task.transactionHash
        );
        let operation = await bridgeCtxc.queryFilter(operationFilter);

        if (operation.length == 1) {
            arr.splice(index, 1);
        } else if (operation.length > 1) {
            console.error("the operation exuted more than once", task);
            process.exit(2);
        }
    });
    kv_heco.pendingTask = suspensiveTasksH;
}

/**
 * update the checkpoint by send transaction to block chain:
 * when the number of finalize task more than the threshold
 */
function shouldUpdateCheckpoint(finishTaskNum) {
    if (finishTaskNum >= threshold) {
        return true;
    }
    return false;
}

// when satisfy trigger condition, call this to update finalize block number.
async function updateCheckpoint(contractInstance, finalizeBlk) {
    // send transaction to nwtwork
    let res = await contractInstance.updateCheckpoint(finalizeBlk);
    // the transaction has been mined
    let receipt = await res.wait();
    console.log("finish update the checkpoint");
}

async function main() {
    let data = await fsPromise.readFile("./config.json");
    data = JSON.parse(data);
    config = data[mode];

    const operatorPrv = config.operator;
    const ctxcUrl = config.ctxcUrl;
    const hecoUrl = config.hecoUrl;
    const confirmations = config.confirmations;

    const providerCtxc = new ethers.getDefaultProvider(ctxcUrl);
    const providerHeco = new ethers.getDefaultProvider(hecoUrl);

    let signerCtxc = new ethers.Wallet(operatorPrv, providerCtxc);
    let signerHeco = new ethers.Wallet(operatorPrv, providerHeco);

    const bridgeCtxc = await getContractInstance("BridgeCtxc", signerCtxc);
    const bridgeHeco = await getContractInstance("BridgeHeco", signerHeco);
    const bridgeToken = await getContractInstance("BridgeToken", signerHeco);

    console.log("restore the state from blockchain log data");
    await restoreFromChain(bridgeCtxc, bridgeHeco);

    console.log("the pending task:", kv_ctxc.pendingTask);
    console.log("-----------len ----------", kv_ctxc.pendingTask.length);

    console.log("register listeners for events");

    bridgeCtxc.on("Deposit", (from, to, amount, event) => {
        console.log("get the event from Ctxc deposit");
        console.log("from: ", from, "to: ", to, "with amount: ", amount);
        kv_ctxc.pendingTask.push(event);
    });

    bridgeHeco.on("DepositToken", (from, to, amount, event) => {
        console.log("get the event from Heco deposit");
        console.log("from: ", from, "to: ", to, "with amount: ", amount);
        kv_heco.pendingTask.push(event);
    });

    setInterval(async () => {
        if (
            kv_ctxc.processingTask.length == 0 &&
            kv_ctxc.pendingTask.length != 0
        ) {
            console.log("... handle the task ...");
            let task = kv_ctxc.pendingTask.shift();
            kv_ctxc.processingTask.push(task);
            console.log("======= task is ============", task);
            let to = task.args.to;
            let amount = task.args.amount;
            console.log("to ", to, "amount: ", amount);
            let res = await bridgeHeco.withdrawToken(
                to,
                amount,
                task.transactionHash
            );
            let receipt = await res.wait();
            // if transaction is reverted, just write it into log for manual retry.
            if (receipt.status == 0) {
                // the transaction send will choke here, because the processingTask is always not null.
                // we should figure out a method to deal with this condition
                console.error("the transaction has been fail", receipt);
            } else {
                kv_ctxc.processingTask.pop();
                finishTaskC += 1;
            }
            if (task.blockNumber > finalizeBlkC) {
                finalizeBlkC = task.blockNumber;
            }
            if (shouldUpdateCheckpoint(finishTaskC)) {
                await updateCheckpoint(bridgeCtxc, finalizeBlkC);
            }
            console.log("finish the deposit task: ");
        }
    }, 1500);

    setInterval(async () => {
        if (
            kv_heco.processingTask.length == 0 &&
            kv_heco.pendingTask.length != 0
        ) {
            console.log("... handle the task ...");
            let task = kv_heco.pendingTask.shift();
            kv_heco.processingTask.push(task);
            let to = task.args.to;
            let amount = task.args.amount;
            console.log("to ", to, "amount: ", amount);
            let res = await bridgeHeco.withdrawToken(to, amount);
            let receipt = await res.wait();
            // if transaction is reverted, just write it into log for manual retry.
            if (receipt.status == 0) {
                console.error("the transaction has been fail", receipt);
            } else {
                kv_heco.processingTask.pop();
                finishTaskH += 1;
            }
            if (task.blockNumber > finalizeBlkH) {
                finalizeBlkH = task.blockNumber;
            }
            if (shouldUpdateCheckpoint(finishTaskH)) {
                await updateCheckpoint(bridgeHeco, finalizeBlkH);
            }
            console.log("finish the withdraw task");
        }
    });
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

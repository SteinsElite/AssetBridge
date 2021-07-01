const ethers = require("ethers");
const fs = require("fs");
const fsPromise = fs.promises;

class OperatorState {
  constructor(threshold) {
    this.threshold = threshold;

    this.finalizeBlkC = 0;
    // the latest block number of the pending tasks
    this.initBlkC = 0;
    this.finishTaskC = 0;
    this.pendingTasksC = [];
    this.processingTasksC = [];
    // indicate that we could process the task in the pending tasks
    this.activateEntryC = false;

    this.finalizeBlkH = 0;
    // the latest block number of the pending tasks
    this.initBlkH = 0;
    this.finishTaskH = 0;
    this.pendingTasksH = [];
    this.processingTasksH = [];
    // indicate that we could process the task in the pending tasks
    this.activateEntryH = false;
  }

  /**
   * operation in (..., finalizeBlkC] is finalized, no need to check.
   * operation in (finalizeBlk, currentBlk] is require to check for rebuilding the node state
   * due to we have no idea which operation is finished(could be optimzie with redis as the cache).
   * @param bridgeC: bridge contract instance on cortex
   * @param bridgeH: bridge contract instance on heco
   */
  async restoreFromChain(bridgeC, bridgeH) {
    console.log("Restore from blockchain data ...");
    this.finalizeBlkC = (await bridgeC.checkPoint()).toNumber();
    let fromBlkC = this.finalizeBlkC + 1;

    this.initBlkC = await bridgeC.provider.getBlockNumber();

    let suspensiveTasksC = await bridgeC.queryFilter("Deposit", fromBlkC, this.initBlkC);

    // we should handle all the request tasks, once it has completed, we restore from chain successfully.
    suspensiveTasksC.forEach(async (task, index, arr) => {
      let operationFilter = bridgeH.filters.WithdrawToken(null, task.transactionHash);
      let operation = await bridgeH.queryFilter(operationFilter);

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
    this.pendingTasksC = suspensiveTasksC;

    this.finalizeBlkH = (await bridgeH.checkPoint()).toNumber();
    let fromBlkH = this.finalizeBlkH + 1;
    this.initBlkH = await bridgeH.provider.getBlockNumber();

    let suspensiveTasksH = await bridgeH.queryFilter(
      "DepositToken",
      fromBlkH,
      this.initBlkH
    );
    suspensiveTasksH.forEach(async (task, index, arr) => {
      let operationFilter = bridgeC.filters.Withdraw(null, task.transactionHash);
      let operation = await bridgeC.queryFilter(operationFilter);

      if (operation.length == 1) {
        arr.splice(index, 1);
      } else if (operation.length > 1) {
        console.error("the operation exuted more than once", task);
        process.exit(2);
      }
    });
    this.pendingTaskH = suspensiveTasksH;

    console.log(
      "Restore finish:",
      "pendingTaskC - ",
      this.pendingTasksC.length,
      "pendingTaskH - ",
      this.pendingTasksH.length
    );
  }

  async handleTaskC(bridgeC, bridgeH) {
    // only when processing task is null(we can handle next task only after previous task is verified)
    if (this.processingTasksC.length == 0 && this.pendingTasksC.length != 0) {
      console.log("handle the task ...");
      let task = this.pendingTasksC.shift();
      this.processingTasksC.push(task);

      let to = task.args.to;
      let amount = task.args.amount;
      // operator trigger withdraw on heco chain to hand out "h-token"
      let rsp = await bridgeH.withdrawToken(to, amount, task.transactionHash);
      try {
        let receipt = await rsp.wait();
        this.processingTasksC.pop();
        this.finishTaskC += 1;
      } catch (err) {
        console.error("fail with: ", err);
      }
      if (task.blockNumber > this.finalizeBlkC) {
        this.finalizeBlkC = task.blockNumber;
      }
      if (this.finishTaskC >= this.threshold) {
        await this.updateCheckpoint(bridgeC, this.finalizeBlkC);
        this.finishTaskC = 0;
      }
      console.log("finish the task",task.transactionHash);
    }
  }

  async handleTaskH(bridgeC, bridgeH) {
    if (this.processingTasksH.length == 0 && this.pendingTasksH.length != 0) {
      console.log("handle the task ...");
      let task = this.pendingTasksH.shift();
      this.processingTasksH.push(task);
      let to = task.args.to;
      let amount = task.args.amount;

      let rsp = await bridgeC.withdraw(to, amount, task.transactionHash);
      try {
        let receipt = await rsp.wait();
        this.processingTasksH.pop();
        this.finishTaskH += 1;
      } catch (err) {
        console.error("faile with : ", err);
      }

      if (task.blockNumber > this.finalizeBlkH) {
        this.finalizeBlkH = task.blockNumber;
      }
      if (this.finishTaskH >= this.threshold) {
        await this.updateCheckpoint(bridgeH, this.finalizeBlkH);
        this.finishTaskH = 0;
      }
      console.log("finish the task");
    }
  }

  // when satisfy trigger condition, call this to update finalize block number.
  async updateCheckpoint(contractInstance, finalizeBlk) {
    // send transaction to nwtwork
    let res = await contractInstance.updateCheckpoint(finalizeBlk);
    // the transaction has been mined
    let receipt = await res.wait();
    console.log("finish update the checkpoint");
  }
}

// some config params
// local: run on ethereumjs vm
// test: run on test network(e.g. heco test network, kovan ..)
const modes = ["local", "test", "main"];
let mode = modes[1];
let interval = 1500;

async function getContractInstance(name, signer) {
  let artifactPath = "./artifacts/contracts/" + name + ".sol/" + name + ".json";
  let addrPath = "./addr.json";

  let data = await fsPromise.readFile(artifactPath);
  data = JSON.parse(data);

  let addr = await fsPromise.readFile(addrPath);
  addr = JSON.parse(addr);
  addr = addr[mode];
  return new ethers.Contract(addr[name], data.abi, signer);
}

/**
 * get the bridge instance of contract (with signer and provider)
 *
 */
async function obtainBridge() {
  let data = await fsPromise.readFile("./config.json");
  data = JSON.parse(data);
  let config = data[mode];

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

  return [bridgeCtxc, bridgeHeco, bridgeToken];
}

async function main() {
  let [bridgeC, bridgeH, token] = await obtainBridge();

  let operatorState = new OperatorState(5);
  await operatorState.restoreFromChain(bridgeC, bridgeH);

  console.log("... listen for new operation ...");
  bridgeC.on("Deposit", (from, to, amount, event) => {
    console.log("... Ctxc ==> Heco operation ...");
    console.log("from: ", from, "to: ", to, "with amount: ", amount);
    console.log("event block: ", event.blockNumber);
    if (event.blockNumber > operatorState.initBlkC) {
      operatorState.pendingTasksC.push(event);
    }
  });
  bridgeH.on("DepositToken", (from, to, amount, event) => {
    console.log("... Heco ==> Ctxc operation ...");
    console.log("from: ", from, "to: ", to, "with amount: ", amount);
    console.log("event block: ", event.blockNumber);
    if (event.blockNumber > operatorState.initBlkH) {
      operatorState.pendingTasksH.push(event);
    }
  });

  // handle the task
  setInterval(() => operatorState.handleTaskC(bridgeC, bridgeH), interval);
  setInterval(() => operatorState.handleTaskH(bridgeC, bridgeH), interval);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

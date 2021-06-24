const ethers = require("ethers");
const fs = require("fs");
const events = require("events");
const { NonceManager } = require("@ethersproject/experimental");
const { tasks } = require("hardhat");
const fsPromise = fs.promises;

// there are 4 state of each task from for each bridge side, when state is in the finish state
// we drop it
// pending task is request that are get from the onchain event emitter
let pendingTask = [];

let readyTask = [];

let processingTask = [];

// some config params
// local: run on ethereumjs vm
// test: run on test network(e.g. heco test network, kovan ..)
const modes = ["local", "test", "main"];
let mode = modes[0];

async function getContractInstance(name, signer) {
  let artifactPath = "./artifacts/contracts/" + name + ".sol/" + name + ".json";
  console.log("path for ", name, "is: ", artifactPath);
  let addrPath = "./addr.json";

  let data = await fsPromise.readFile(artifactPath);
  data = JSON.parse(data);

  let addr = await fsPromise.readFile(addrPath);
  addr = JSON.parse(addr);
  addr = addr[mode];
  return new ethers.Contract(addr[name], data.abi, signer);
}

async function main() {
  let data = await fsPromise.readFile("./config.json");
  data = JSON.parse(data);
  config = data[mode];

  const operatorPrv = config.operator;
  const ctxcUrl = config.ctxcUrl;
  const hecoUrl = config.hecoUrl;

  const providerCtxc = new ethers.getDefaultProvider(ctxcUrl);
  const providerHeco = new ethers.getDefaultProvider(hecoUrl);

  let signerCtxc = new ethers.Wallet(operatorPrv, providerCtxc);
  let signerHeco = new ethers.Wallet(operatorPrv, providerHeco);

  const bridgeCtxc = await getContractInstance("BridgeCtxc", signerCtxc);
  const bridgeHeco = await getContractInstance("BridgeHeco", signerHeco);
  const bridgeToken = await getContractInstance("BridgeToken", signerHeco);

  console.log("wait for event in loop");

  bridgeCtxc.on("Deposit", (from, to, amount, event) => {
    console.log("get the event from Ctxc deposit");
    console.log("from: ", from, "to: ", to, "with amount: ", amount);
    console.log("event: ", event);
    pendingTask.push(event);
  });

  bridgeHeco.on("Deposit", (from, to, amount, event) => {
    console.log("get the event from Heco deposit");
    console.log("from: ", from, "to: ", to, "with amount: ", amount);
    kv2.push(event);
  });

  setInterval(async () => {
    if (processingTask.length == 0 && pendingTask.length != 0) {
      console.log("deal with the event ...");
      let task = pendingTask.shift();
      processingTask.push(task);
      let to = task.args.to;
      let amount = task.args.amount;
      console.log("to ", to, "amount: ", amount);
      let res = await bridgeHeco.withdrawToken(to, amount);
      let receipt = await res.wait();
      // if transaction is reverted, just write it into log for manual retry.
      if (receipt.status == 0) {
        console.error("the transaction has been fail", receipt);
      } else {
        processingTask.pop();
      }
      console.log("finish the task");
    }
  }, 1500);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

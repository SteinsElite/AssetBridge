// the storage is use for put data into the backend database(redis)

const Redis = require("ioredis");
const redis = new Redis(); // uses defaults unless given configuration object

// interface to export

// use to query if there is valid task waiting for being processed, if yes
// return the task, or just return null
function acquireTask(chain) {}

// when obtain event from the blockchain log, push the task into the pending queue
function addTask(chain, eventData) {
  let blockNumber = eventData.blockNumber;
  let txIndex = eventData.transactionIndex;
  let to = eventData.args;
  let amount = eventData.args.amount;
  let txHash = eventData.args.transactionHash;

  //put data into redis
  let id = blockNumber.toString() + "-" + txIndex.toString();
  let key = "pending" + "_" + chain;
  await redis.xadd(
    key,
    id,
    "to",
    to,
    "amount",
    amount,
    "txHash",
    txHash
  );
}

// when processing task, send a semaphare to show that the tasking is being processed
function processingTask(chain, task) {}

module.exports = { acquireTask, addTask, processingTask };

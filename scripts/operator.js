const ethers = require("ethers");
const fs = require("fs");
const fsPromise = fs.promises;
const obtainBridge = require("./bridgeInstance");
// const { loggerC, loggerH } = require("./logger");
const { loggerC, loggerH } = require("./logger2");
// we should make sure that tx before the 900 block should be processed success.
const maxBlkIntervalC = 1000;
const maxBlkIntervalH = 3000;

// the max number logs we could get from the blockchain node server
const blkLogLimit = 90000;

const STATESTATUS = {
  READY: 0, // ready for process new task
  BUSY: 1, // this is exist enough task to be finished
  IDLE: 2, // there is no task avaible
};

// flag show that if the opeartor is update for maintain purpose to avoid maintain for twice
let isMaintainC = false;
let isMaintainH = false;

// some config params
// local: run on ethereumjs vm
// test: run on test network(e.g. heco test network, kovan ..)
const modes = ["local", "test", "main"];
let mode = modes[2];
let interval = 3000;

// the state of the bridge of the cortex endpoint
class OperatorStateC {
  constructor(bridgeC, bridgeH) {
    // init with the finalizeBlk, but will progressive increase when finish processing a block
    this.finalizeBlkInx = 0;
    // the block number of the operation which is in processing( there may be more than 1 operation in a block)
    this.processingBlkInx = 0;
    // the latest block when we restore the opeartor(should exclude from the follow-up monitor)
    this.restoreToBlkInx = 0;

    // the tasks that wait for process on the target block chain
    this.pendingTasks = [];
    // the task that are processing, the length of it should be 1
    this.processingTasks = [];

    // ====== the contract instance to interact with block chain(include provider&signer) ====
    this.bridgeC = bridgeC;
    this.bridgeH = bridgeH;
  }

  /**operation in (..., checkpoint] is finalized, no need to check.
   * operation in (checkpoint, currentBlk] is require to check for rebuilding the node state
   * due to we have no idea which operation is finished(could be optimzie with redis as the cache) .
   */
  async restoreFromChain() {
    loggerC.log("info", "restore state from cortex log data", { op: "RESTORE-START" });
    // init the 3 blk index as the same
    this.finalizeBlkInx = (
      await this.bridgeC.checkPoint({ gasLimit: 1000000 })
    ).toNumber();
    this.processingBlkInx = this.finalizeBlkInx;

    let fromBlkInx = this.finalizeBlkInx + 1;
    let toBlkInx = await this.bridgeC.provider.getBlockNumber();
    this.restoreToBlkInx = toBlkInx;

    let suspensiveTask = await this.bridgeC.queryFilter("Deposit", fromBlkInx, toBlkInx);
    console.log(suspensiveTask);
    loggerC.log(
      "info",
      `the number of suspensive task in (checkpoint, currentBlk]: ${suspensiveTask.length}`,
      { op: "RESTORE-ING" }
    );
    // we should handle all the request tasks, once it has completed, we restore from chain successfully.
    let blkH = (await this.bridgeH.provider.getBlockNumber()) - blkLogLimit;
    for (let i = suspensiveTask.length - 1; i >= 0; i--) {
      let operationFilter = this.bridgeH.filters.WithdrawToken(
        null,
        suspensiveTask[i].transactionHash
      );
      //query the log in [latest - blkLogLimit, latest], we should not broke down more than the
      let operation = await this.bridgeH.queryFilter(operationFilter, blkH);
      if (operation.length == 1) {
        suspensiveTask.splice(i, 1);
      }
    }
    // now the task still in the suspensiveTasks is operation need to be excuted.
    this.pendingTasks = suspensiveTask;
    loggerC.log(
      "info",
      `finish restore from blk ${fromBlkInx} to ${toBlkInx} with ${this.pendingTasks.length} pending task`,
      { op: "RESTORE-FINISH" }
    );
  }

  status() {
    if (this.processingTasks.length > 0) {
      return STATESTATUS.BUSY;
    } else if (this.pendingTasks.length > 0) {
      return STATESTATUS.READY;
    }
    return STATESTATUS.IDLE;
  }

  // sync the local state node from the onchain operation
  async syncState() {
    if (this.status() == STATESTATUS.READY) {
      // the excuteOperation is atmoic for the status, only when finish all the excute,
      // will change the STATUS READY to other.
      await this.excuteOperation();
    } else if (this.status() == STATESTATUS.IDLE && !isMaintainC) {
      await this.updateCheckpointForMaintain();
    }
  }

  async excuteOperation() {
    // STATUS ==> BUSY
    let task = this.pendingTasks.shift();
    this.processingTasks.push(task);

    let to = task.args.to;
    let amount = task.args.amount;
    loggerC.log(
      "info",
      `excute the operation: [to ${to} amount ${amount}] of id ${task.blockNumber}-${task.transacationIndex}`,
      { op: "EXCUTEOP" }
    );

    try {
      // operator trigger withdraw on heco chain to hand out "h-token"
      let rsp = await this.bridgeH.withdrawToken(to, amount, task.transactionHash);
      var re = await rsp.wait();
      await this.updateCheckpointForOp();
    } catch (err) {
      loggerC.log("error", `fail to excute the operation with ${err}`, {
        op: "EXCUTEOP",
      });
    }
    if (task.blockNumber > this.processingBlkInx) {
      this.finalizeBlkInx = this.processingBlkInx;
      this.processingBlkInx = task.blockNumber;
    }
    // STATUS escape from BUSY, to atmoic handle task
    loggerC.log(
      "info",
      `finsih apply the operation(origin tx hash:${task.transactionHash} ==> apply op hash: ${re.transactionHash})`,
      { op: "OP-RECEIPT" }
    );
    this.processingTasks.pop();
  }

  // trigger when finish excuting aan operation
  // TODO(Erij): should simplify the logic of update the checkpoint.
  async updateCheckpointForOp() {
    let checkpoint = (await this.bridgeC.checkPoint({ gasLimit: 1000000 })).toNumber();
    if (this.finalizeBlkInx >= checkpoint + maxBlkIntervalC) {
      let res = await this.bridgeC.updateCheckpoint(this.finalizeBlkInx);
      let re = await res.wait();
      loggerC.log(
        "info",
        `update the checkpoint after the operation excution(${re.transacationHash})`,
        { op: "CHECKPOINT" }
      );
    }
  }

  // only trigger when the operator is idle,due to we use our own node of heco.there is no need
  async updateCheckpointForMaintain() {
    isMaintainC = true;
    let blkN = (await this.bridgeC.provider.getBlockNumber()) - 1;
    let checkpoint = (await this.bridgeC.checkPoint({ gasLimit: 1000000 })).toNumber();
    if (blkN > checkpoint + maxBlkIntervalC) {
      let res = await this.bridgeC.updateCheckpoint(blkN);
      let re = await res.wait();
      loggerC.log(
        "info",
        `update checkpoint for maintain due to too loog without a transaction(${re.transacationHash})`,
        { op: "CHECKPOINT" }
      );
    }
    isMaintainC = false;
  }
}

// the state of the bridge of the Heco endpoint
class OperatorStateH {
  constructor(bridgeC, bridgeH) {
    // init with the finalizeBlk, but will progressive increase when finish processing a block
    this.finalizeBlkInx = 0;
    // the block number of the operation which is in processing( there may be more than 1 operation in a block)
    this.processingBlkInx = 0;
    // the latest block when we restore the opeartor(should exclude from the follow-up monitor)
    this.restoreToBlkInx = 0;

    // the tasks that wait for process on the target block chain
    this.pendingTasks = [];
    // the task that are processing, the length of it should be 1
    this.processingTasks = [];

    // ====== the contract instance to interact with block chain(include provider&signer) ====
    this.bridgeC = bridgeC;
    this.bridgeH = bridgeH;
  }

  /**operation in (..., checkpoint] is finalized, no need to check.
   * operation in (checkpoint, currentBlk] is require to check for rebuilding the node state
   * due to we have no idea which operation is finished(could be optimzie with redis as the cache) .
   */
  async restoreFromChain() {
    loggerH.log("info", "restore state from heco log data", { op: "RESTORE-START" });
    // init the 3 blk index as the same
    this.finalizeBlkInx = (
      await this.bridgeH.checkPoint({ gasLimit: 1000000 })
    ).toNumber();
    this.processingBlkInx = this.finalizeBlkInx;

    let fromBlkInx = this.finalizeBlkInx + 1;
    let toBlkInx = await this.bridgeH.provider.getBlockNumber();
    this.restoreToBlkInx = toBlkInx;

    let suspensiveTask = await this.bridgeH.queryFilter(
      "DepositToken",
      fromBlkInx,
      toBlkInx
    );
    loggerH.log(
      "info",
      `the number of suspensive task in (checkpoint, currentBlk]: ${suspensiveTask.length}`,
      { op: "RESTORE-ING" }
    );
    // we should handle all the request tasks, once it has completed, we restore from chain successfully.
    let blkC = (await this.bridgeC.provider.getBlockNumber()) - blkLogLimit;
    for (let i = suspensiveTask.length - 1; i >= 0; i--) {
      let operationFilter = this.bridgeC.filters.Withdraw(
        null,
        suspensiveTask[i].transactionHash
      );
      //query the log in [latest - blkLogLimit, latest], we should not broke down more than the
      let operation = await this.bridgeC.queryFilter(operationFilter, blkC);
      if (operation.length == 1) {
        suspensiveTask.splice(i, 1);
      }
    }
    // now the task still in the suspensiveTasks is operation need to be excuted.
    this.pendingTasks = suspensiveTask;
    loggerH.log(
      "info",
      `finish restore from blk ${fromBlkInx} to ${toBlkInx} with ${this.pendingTasks.length} pending task`,
      { op: "RESTORE-FINISH" }
    );
  }

  status() {
    if (this.processingTasks.length > 0) {
      return STATESTATUS.BUSY;
    } else if (this.pendingTasks.length > 0) {
      return STATESTATUS.READY;
    }
    return STATESTATUS.IDLE;
  }

  // sync the local state node from the onchain operation
  async syncState() {
    if (this.status() == STATESTATUS.READY) {
      // the excuteOperation is atmoic for the status, only when finish all the excute,
      // will change the STATUS READY to other.
      await this.excuteOperation();
    } else if (this.status() == STATESTATUS.IDLE && !isMaintainH) {
      await this.updateCheckpointForMaintain();
    }
  }

  /**
   * @param task: task  to be processed, one task represent one operation
   */
  async excuteOperation() {
    // STATUS ==> BUSY
    let task = this.pendingTasks.shift();
    this.processingTasks.push(task);

    let to = task.args.to;
    let amount = task.args.amount;

    loggerH.log(
      "info",
      `excute the operation: [to ${to} amount ${amount}] of id ${task.blockNumber}-${task.transacationIndex}`,
      { op: "EXCUTEOP" }
    );

    try {
      // operator trigger withdraw on heco chain to hand out "h-token"
      let rsp = await this.bridgeC.withdraw(to, amount, task.transactionHash);
      var re = await rsp.wait();
      await this.updateCheckpointForOp();
    } catch (err) {
      loggerH.log("error", `fail to excute the operation with: ${err}`, {
        op: "EXCUTEOP",
      });
    }
    if (task.blockNumber > this.processingBlkInx) {
      this.finalizeBlkInx = this.processingBlkInx;
      this.processingBlkInx = task.blockNumber;
    }
    // STATUS escape from BUSY, to atmoic handle task
    loggerH.log(
      "info",
      `finsih apply the operation(origin tx hash:${task.transactionHash} ==> apply op hash: ${re.transactionHash})`,
      { op: "OP-RECEIPT" }
    );
    this.processingTasks.pop();
  }

  // trigger when finish excuting aan operation
  // TODO(Erij): should simplify the logic of update the checkpoint.
  async updateCheckpointForOp() {
    let checkpoint = (await this.bridgeH.checkPoint({ gasLimit: 1000000 })).toNumber();
    if (this.finalizeBlkInx >= checkpoint + maxBlkIntervalH) {
      let res = await this.bridgeH.updateCheckpoint(this.finalizeBlkInx);
      let re = await res.wait();
      loggerH.log(
        "info",
        `update the checkpoint after operation excution(${re.transacationHash})`,
        { op: "CGECKPOINT" }
      );
    }
  }

  // only trigger when the operator is idle,due to we use our own node of heco.there is no need
  async updateCheckpointForMaintain() {
    isMaintainH = true;
    let blkN = (await this.bridgeH.provider.getBlockNumber()) - 1;
    let checkpoint = (await this.bridgeH.checkPoint({ gasLimit: 1000000 })).toNumber();
    if (blkN > checkpoint + maxBlkIntervalH) {
      let res = await this.bridgeH.updateCheckpoint(blkN);
      await res.wait();
      loggerH.log(
        "info",
        `update checkpoint for maintain（too loog without a transaction(${re.transacationHash})`,
        { op: "CHECKPOINT" }
      );
    }
    isMaintainH = false;
  }
}

async function main() {
  let [bridgeC, bridgeH, token] = await obtainBridge(mode);

  let operatorStateC = new OperatorStateC(bridgeC, bridgeH);
  let operatorStateH = new OperatorStateH(bridgeC, bridgeH);
  await operatorStateC.restoreFromChain();
  await operatorStateH.restoreFromChain();

  console.log(">>> listen for new operation ...");
  bridgeC.on("Deposit", (from, to, amount, event) => {
    console.log("--- Ctxc ==> Heco operation ...");
    console.log("from: ", from, "to: ", to, "with amount: ", amount);
    // not include the block for twice
    if (event.blockNumber > operatorStateC.restoreToBlkInx) {
      operatorStateC.pendingTasks.push(event);
    }
  });

  bridgeH.on("DepositToken", (from, to, amount, event) => {
    console.log("--- Heco ==> Ctxc operation ...");
    console.log("from: ", from, "to: ", to, "with amount: ", amount);
    console.log("event block: ", event.blockNumber);
    if (event.blockNumber > operatorStateH.restoreToBlkInx) {
      operatorStateH.pendingTasks.push(event);
    }
  });

  // handle the task
  // setInterval(() => operatorStateC.syncState(), interval);
  // setInterval(() => operatorStateH.syncState(), interval);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

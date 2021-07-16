const ethers = require("ethers");
const fs = require("fs");
const fsPromise = fs.promises;


async function getContractInstance(name, signer, mode) {
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
async function obtainBridge(mode) {
  let data = await fsPromise.readFile("./config.json");
  data = JSON.parse(data);
  let config = data[mode];

  const operatorPrv = config.operator;
  const ctxcUrl = config.ctxcUrl;
  const hecoUrl = config.hecoUrl;
  // const confirmations = config.confirmations;

  const providerCtxc = new ethers.getDefaultProvider(ctxcUrl);
  const providerHeco = new ethers.getDefaultProvider(hecoUrl);

  let signerCtxc = new ethers.Wallet(operatorPrv, providerCtxc);
  let signerHeco = new ethers.Wallet(operatorPrv, providerHeco);

  const bridgeCtxc = await getContractInstance("BridgeCtxc", signerCtxc, mode);
  const bridgeHeco = await getContractInstance("BridgeHeco", signerHeco, mode);
  const bridgeToken = await getContractInstance("BridgeToken", signerHeco, mode);

  return [bridgeCtxc, bridgeHeco, bridgeToken];
}

module.exports = obtainBridge;
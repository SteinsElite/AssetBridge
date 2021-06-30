const ethers = require("ethers");
const fs = require("fs");
const fsPromise = fs.promises;

// some config params
// local: run on ethereumjs vm
// test: run on test network(e.g. heco test network, kovan ..)
const modes = ["local", "test", "main"];
let mode = modes[0];

// get contract instance to interact with by etherjs
async function getContractInstance(name, signer) {
  let artifactPath = "./artifacts/contracts/" + name + ".sol/" + name + ".json";
  let addrPath = "./addr.json";
  console.log("the artifact path is", artifactPath);

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

  const usrPrv = config.user;
  const ctxcUrl = config.ctxcUrl;
  const hecoUrl = config.hecoUrl;

  const providerCtxc = new ethers.getDefaultProvider(ctxcUrl);
  const providerHeco = new ethers.getDefaultProvider(hecoUrl);

  const signerCtxc = new ethers.Wallet(usrPrv, providerCtxc);
  const signerHeco = new ethers.Wallet(usrPrv, providerHeco);

  const bridgeCtxc = await getContractInstance("BridgeCtxc", signerCtxc);
  const bridgeHeco = await getContractInstance("BridgeHeco", signerHeco);
  const bridgeToken = await getContractInstance("BridgeToken", signerHeco);

  const user = await signerCtxc.getAddress();

  const epoch = 5;

  // Ctxc ==> Heco
  for (let i = 0; i < epoch; i++) {
    console.log("...  Ctxc ==> Heco  ...");
    // get the response when send the transaction to the network but may not mined yet
    let res = await bridgeCtxc.deposit(user, i, { value: i });
  }

//   // Heco ==> Ctxc
//   for (let j = 0; j < epoch; j++) {
//     console.log("...Heco ==> Ctxc ...");
//     let res = await bridgeHeco.depositToken(user, 1);
//   }

}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

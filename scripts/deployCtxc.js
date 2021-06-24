const fs = require("fs");
const fsPromise = fs.promises;

async function main() {
  // We get the contract to deploy
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  const BridgeCtxc = await ethers.getContractFactory("BridgeCtxc");
  const bridgeCtxc = await BridgeCtxc.deploy(
    deployer.address,
    deployer.address
  );
  await bridgeCtxc.deployed();
  console.log("Bridge Ctxc deployed to:", bridgeCtxc.address);

  let addr = await fsPromise.readFile("./addr.json");
  if (addr == "") {
    addr = {};
  }else {
    addr = JSON.parse(addr);
  }

  let network = await deployer.provider.getNetwork();
  // kovan
  if (network.chainId == 42) {
    if (addr.test == undefined) {
      addr.test = {};
    }
    addr.test.BridgeCtxc = bridgeCtxc.address;
  } else if (network.chainId == 31337) {
    if (addr.local == undefined) {
      addr.local = {};
    }
    addr.local.BridgeCtxc = bridgeCtxc.address;
  }

  let data = JSON.stringify(addr, null, 2);
  await fsPromise.writeFile("./addr.json", data);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

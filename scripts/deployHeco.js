const fs = require("fs");
const fsPromise = fs.promises;

async function main() {
  // We get the contract to deploy
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  const BridgeHeco = await ethers.getContractFactory("BridgeHeco");
  const bridgeHeco = await upgrades.deployProxy(BridgeHeco, [
    deployer.address,
    deployer.address,
  ]);
  await bridgeHeco.deployed();
  console.log("Bridge Heco deployed to:", bridgeHeco.address);

  //update the addr json when deployed
  let addr = await fsPromise.readFile("./addr.json");
  if (addr == "") {
    addr = {};
  } else {
    addr = JSON.parse(addr);
  }

  let bridgeTokenAddr = await bridgeHeco.tokenAddress();

  let network = await deployer.provider.getNetwork();
  // heco test
  if (network.chainId == 256) {
    if (addr.test == undefined) {
      addr.test = {};
    }
    addr.test.BridgeHeco = bridgeHeco.address;
    addr.test.BridgeToken = bridgeTokenAddr;
  } else if (network.chainId == 31337) {
    // local vmjs
    if (addr.local == undefined) {
      addr.local = {};
    }
    addr.local.BridgeHeco = bridgeHeco.address;
    addr.local.BridgeToken = bridgeTokenAddr;
  }
  let data = JSON.stringify(addr, null, 2);
  await fsPromise.writeFile("./addr.json", data);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

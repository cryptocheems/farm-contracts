const { web3, mainAddr } = require("./web3")();
const GovernanceWrapperData = require("../../build/contracts/GovernanceWrapper.json");
const addresses = require("../../addresses.json");
const { safeBN } = require("../../test/utils")(web3);

const INITIAL_POOLS = {
  "0x9e8E5e4a0900fE4634c02AAf0f130cfB93c53fBc": 20,
  "0x4505b262dc053998c10685dc5f9098af8ae5c8ad": 5,
  "0x0e3e9cceb13c9f8c6faf7a0f00f872d6291630de": 5,
  "0x50a4867aee9cafd6ddc84de3ce59df027cb29084": 3,
  "0x89e2f342b411032a580fefa17f96da6a5bef4112": 3,
  "0x1af298d8bfd6e36ccdfd4b3659077d7a3b573d45": 2,
  "0x10e0a7dd52d4c600a4435a6632f3111aa4f18662": 2,
  "0xb3011007ebbb56c791eaebf87fe035190b8dbe62": 2,
  "0x7bea4af5d425f2d4485bdad1859c88617df31a67": 2,
  "0x01f4a4d82a4c1cf12eb2dadc35fd87a14526cc79": 1,
};

const GAS_PRICE = "1100000000";

async function main() {
  console.log("addresses.xdai.governanceWrapper: ", addresses.xdai.governanceWrapper);
  const gov = new web3.eth.Contract(GovernanceWrapperData.abi, addresses.xdai.governanceWrapper);
  const pools = [];
  const weights = [];
  const isAdding = [];
  for (const [pool, weight] of Object.entries(INITIAL_POOLS)) {
    pools.push(pool);
    weights.push(safeBN(weight));
    isAdding.push(true);
  }
  await gov.methods
    .modifyPools(pools, weights, isAdding)
    .send({ from: mainAddr, gas: 3000000, gasPrice: GAS_PRICE });
}

main().then(() => process.exit(0));

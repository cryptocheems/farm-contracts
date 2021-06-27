const { getDetAddr, safeBN } = require("../test/utils");
const { BN } = require("bn.js");
const Farm = artifacts.require("CheemscoinFarm");
const Cheemscoin = artifacts.require("Cheemscoin");

module.exports = async (deployer, _, [owner]) => {
  const ether = wei => new BN(web3.utils.toWei(wei.toString()));

  const nonce = (await web3.eth.getTransactionCount(owner)) - 1;
  const cheemsAmount = ether("172605");

  const SCALE = ether("1");
  const currentTime = Math.floor(new Date() / 1000);
  const duration = 180 * 24 * 60 * 60; // 180 days
  const startTime = safeBN(currentTime);
  const endTime = safeBN(currentTime + duration);
  const endDistFrac = ether("0.25"); // :|
  const minTimelock = safeBN(48 * 60 * 60); // 2 days
  // TODO: check if they can withdraw once rewards have stopped
  const maxTimelock = safeBN(duration);
  // TODO: mess with this
  const timeLockMultiplier = SCALE.div(safeBN(20 * 30 * 24 * 60 * 60));
  // TODO: check this
  const downgradeFee = ether("0.0001");

  const allocations = [
    { address: "0xbd8B3bdce99424a957eFe338ef52d6FDC0Aef417", weighting: 70 },
    { address: "0x898a88e52ff5b96AaD346645c1471Ba8e5625172", weighting: 20 },
    { address: "0x22cF19aFDAf9DF62cDE6367012a31E3Ad6e4E485", weighting: 10 },
  ];

  const cheems = await Cheemscoin.deployed();
  // This should approve the farm contract if nonce is correct
  await cheems.approve(getDetAddr(owner, nonce + 2), cheemsAmount);

  await deployer.deploy(Farm, cheems.address, [
    startTime,
    endTime,
    cheemsAmount,
    endDistFrac,
    minTimelock,
    maxTimelock,
    timeLockMultiplier,
    SCALE, // timeLockConstant
    downgradeFee,
  ]);

  // Add pools
  const farm = await Farm.deployed();
  allocations.forEach(async ({ address, weighting }) => {
    await farm.add(address, weighting);
  });
};

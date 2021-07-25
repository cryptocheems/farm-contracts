const { getDetAddr, safeBN } = require("../test/utils");
const { BN } = require("bn.js");
const Farm = artifacts.require("CheemscoinFarm");
const Cheemscoin = artifacts.require("Cheemscoin");

module.exports = async (deployer, _, [owner]) => {
  const ether = wei => new BN(web3.utils.toWei(wei.toString()));

  const nonce = (await web3.eth.getTransactionCount(owner)) - 1;
  const cheemsAmount = ether("172605");
  // const cheemsAmount = ether("140");

  const SCALE = ether("1");
  const tomorrow = Math.floor(new Date() / 1000) + 24 * 60 * 60; // time 1 day later
  const duration = 90 * 24 * 60 * 60; // 90 days
  // const duration = 7 * 24 * 60 * 60; // 7 days
  const startTime = safeBN(tomorrow);
  const endTime = safeBN(tomorrow + duration);
  const endDistFrac = ether("0.25"); // :|
  const minTimelock = safeBN(48 * 60 * 60); // 2 days
  const maxTimelock = safeBN(duration);
  // 90 days is a 6x
  const timeLockMultiplier = safeBN(10)
    .pow(safeBN("18"))
    .mul(safeBN("5"))
    .div(safeBN(90 * 24 * 3600)); // 90 days
  const downgradeFee = ether("0.0001");

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
};

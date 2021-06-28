const { getDetAddr, safeBN } = require("../test/utils");
const { BN } = require("bn.js");
const Farm = artifacts.require("CheemscoinFarm");
const Cheemscoin = artifacts.require("Cheemscoin");

module.exports = async (deployer, _, [owner]) => {
  const ether = wei => new BN(web3.utils.toWei(wei.toString()));

  const nonce = (await web3.eth.getTransactionCount(owner)) - 1;
  const cheemsAmount = ether("172605");

  const SCALE = ether("1");
  // TODO: Change this back
  const tomorrow = Math.floor(new Date() / 1000);
  // const tomorrow = Math.floor(new Date() / 1000) + 24 * 60 * 60; // time 1 day later
  // TODO: Change this too
  // const duration = 180 * 24 * 60 * 60; // 180 days
  const duration = 3 * 24 * 60 * 60; // 3 days
  const startTime = safeBN(tomorrow);
  const endTime = safeBN(tomorrow + duration);
  const endDistFrac = ether("0.25"); // :|
  const minTimelock = safeBN(48 * 60 * 60); // 2 days
  // TODO: check if they can withdraw once rewards have stopped
  const maxTimelock = safeBN(duration);
  // TODO: mess with this
  const timeLockMultiplier = SCALE.div(safeBN(20 * 30 * 24 * 60 * 60));
  // TODO: check this
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

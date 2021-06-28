const Farm = artifacts.require("CheemscoinFarm");

module.exports = async _ => {
  const allocations = [
    { address: "0xbd8B3bdce99424a957eFe338ef52d6FDC0Aef417", weighting: 70 },
    { address: "0x898a88e52ff5b96AaD346645c1471Ba8e5625172", weighting: 20 },
    { address: "0x22cF19aFDAf9DF62cDE6367012a31E3Ad6e4E485", weighting: 10 },
  ];
  const farm = await Farm.deployed();
  allocations.forEach(async ({ address, weighting }) => {
    await farm.add(address, weighting);
  });
};

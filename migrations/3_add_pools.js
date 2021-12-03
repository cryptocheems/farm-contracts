const Farm = artifacts.require("CheemscoinFarm");

module.exports = async (_, network) => {
  const allocations =
    network === "rinkeby"
      ? [
          { address: "0xbd8B3bdce99424a957eFe338ef52d6FDC0Aef417", weighting: 70 },
          { address: "0x898a88e52ff5b96AaD346645c1471Ba8e5625172", weighting: 20 },
          { address: "0x22cF19aFDAf9DF62cDE6367012a31E3Ad6e4E485", weighting: 10 },
        ]
      : [
          { address: "0xce5382ff31b7a6f24797a46c307351fde135c0fd", weighting: 80 }, // xDAI
          { address: "0x972dec20648f57a350d8fe09acd22805fe246c84", weighting: 10 }, // wETH
          { address: "0xe60976a1456d589507cfc11a86f6b8be15fc799c", weighting: 10 }, // wBTC
        ];
  const farm = await Farm.deployed();
  allocations.forEach(async ({ address, weighting }) => {
    await farm.add(address, weighting);
  });
};

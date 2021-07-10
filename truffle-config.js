require("dotenv").config();
const HDWalletProvider = require("@truffle/hdwallet-provider");

module.exports = {
  networks: {
    development: {
      host: "127.0.0.1",
      port: 7545,
      network_id: "*",
    },
    xdai: {
      provider: () => new HDWalletProvider(process.env.MNEMONIC, "https://xdai.1hive.org/"),
      network_id: 100,
      gas: 4_500_000,
      gasPrice: 2.5e9,
    },
    rinkeby: {
      networkCheckTimeout: 90000,
      provider: () => new HDWalletProvider(process.env.MNEMONIC, process.env.ALCHEMY),
      network_id: 4,
      gasPrice: 1e9,
      skipDryRun: true,
      websocket: true,
    },
  },
  compilers: {
    solc: {
      version: "0.7.6",
      settings: {
        optimizer: {
          enabled: true,
          runs: 10000,
        },
      },
    },
  },
};

module.exports = () => {
  require("dotenv").config();
  const Web3 = require("web3");

  const endpoints = [
    process.env.RINKEBY_ENDPOINT,
    process.env.XDAI_ENDPOINT,
    "https://rpc.xdaichain.com/",
    "https://xdai.poanetwork.dev",
    "wss://rpc.xdaichain.com/wss",
    "wss://xdai.poanetwork.dev/wss",
  ];

  const ENDPOINT_INDEX = 5;

  const endpoint = endpoints[ENDPOINT_INDEX];
  console.log("endpoint: ", endpoint);
  if (!endpoint) throw new Error("please set an endpoint");
  const web3 = new Web3(
    endpoint.startsWith("http")
      ? new Web3(new Web3.providers.HttpProvider(endpoint))
      : new Web3.providers.WebsocketProvider(endpoint)
  );

  const privKey = process.env.ACCOUNT0_PRIVATE_KEY;
  if (!privKey) throw new Error("please set a private key");

  const account = web3.eth.accounts.wallet.add(privKey);
  const mainAddr = account.address;

  return { web3, mainAddr };
};

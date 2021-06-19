const { getDetAddr } = require("../test/utils")(null);

function main() {
  const [, , addr, nonceRaw] = process.argv;
  const nonce = parseInt(nonceRaw);
  if (!addr || isNaN(nonce)) throw new Error("required usage: [address] [nonce]");

  console.log("deterministic address:", getDetAddr(addr, nonce));
}

main();

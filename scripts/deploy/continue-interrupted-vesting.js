const { web3, mainAddr } = require("./web3")();
const { loadJson } = require("./utils");
const BN = require("bn.js");
const StreamedAirdropper = require("../../build/contracts/StreamedAirdropper.json");
const addresses = require("../../addresses.json");

const GAS_PRICE = "1100000000";

async function main() {
  const [, , chain, airdropSnapshotSrc] = process.argv;
  console.log("chain: ", chain);
  let startingNonce = await web3.eth.getTransactionCount(mainAddr);
  console.log("startingNonce: ", startingNonce);
  const airdropper = new web3.eth.Contract(StreamedAirdropper.abi, addresses[chain].airdropper);

  const airdropSnapshot = loadJson(airdropSnapshotSrc);
  const allRecipients = (
    await Promise.all(
      Object.entries(airdropSnapshot).map(async ([user, airdropAmount]) => {
        airdropAmount = new BN(airdropAmount, 16);
        const { amountLeft } = await airdropper.methods.vestingUsers(user).call();
        return {
          user,
          airdropAmount,
          alreadyAdded: amountLeft !== "0",
        };
      })
    )
  )
    .filter(({ alreadyAdded }) => !alreadyAdded)
    .map(({ user, airdropAmount }) => [user, airdropAmount]);
  const batchSize = 300;
  const totalRecipients = allRecipients.length;
  const prevRecipients = Object.keys(airdropSnapshot).length;
  console.log(`${totalRecipients}/${prevRecipients} not yet airdropped`);
  console.log(`${prevRecipients - totalRecipients}/${prevRecipients} already airdropped`);
  for (let i = 0; i * batchSize < totalRecipients; i++) {
    const batch = allRecipients.slice(i * batchSize, (i + 1) * batchSize);
    const batchRecipients = batch.map(([recipient]) => recipient);
    const batchAmounts = batch.map(([, amount]) => amount);
    await airdropper.methods
      .addVesting(batchRecipients, batchAmounts)
      .send({
        from: mainAddr,
        nonce: startingNonce++,
        gasPrice: GAS_PRICE,
        gas: Math.max(batchSize * 30000 + 50000, 4000000),
      })
      .on("sending", () => console.log("sending"))
      .on("sent", () => console.log("tx was sent"))
      .on("transactionHash", tx => console.log("tx: ", tx));
    console.log(`${Math.min((i + 1) * batchSize, totalRecipients)}/${totalRecipients}`);
  }
}

main().then(() => process.exit(0));

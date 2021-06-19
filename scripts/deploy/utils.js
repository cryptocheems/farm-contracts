const fs = require("fs");

function loadJson(fp) {
  return JSON.parse(fs.readFileSync(fp));
}

function saveJson(fp, obj, jsonArgs) {
  jsonArgs ??= [];
  fs.writeFileSync(fp, JSON.stringify(obj, ...jsonArgs));
}

async function deploy(deployPromise) {
  let receipt;
  deployPromise.on("receipt", r => (receipt = r));
  const contract = await deployPromise;

  return { contract, receipt };
}

module.exports = { deploy, loadJson, saveJson };

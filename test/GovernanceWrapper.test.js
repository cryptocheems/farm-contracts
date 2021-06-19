const { contract, accounts, web3 } = require("@openzeppelin/test-environment");
const { time, constants, expectRevert, expectEvent } = require("@openzeppelin/test-helpers");
const { ZERO_ADDRESS, MAX_UINT256 } = constants;
const { ether, getDetAddr } = require("./utils")(web3);
const { expect } = require("chai");
const BN = require("bn.js");

const [admin1, manager1, shutdownRecipient1, attacker1] = accounts;

const HoneyFarm = contract.fromArtifact("HoneyFarm");
const GovernanceWrapper = contract.fromArtifact("GovernanceWrapper");
const RewardManager = contract.fromArtifact("RewardManager");
const TestERC20 = contract.fromArtifact("TestERC20");

const SCALE = ether("1");
const ZERO = new BN("0");

describe("GovernanceWrapper", () => {
  before(async () => {
    this.farmToken = await TestERC20.new();

    const currentTime = await time.latest();
    const totalTime = time.duration.years(2);
    const startDelta = time.duration.weeks(1);
    const startTime = currentTime.add(startDelta);
    const endTime = startTime.add(totalTime);

    this.totalDist = ether("950000"); // 0.95 million
    const endDistFrac = ether("0.25");

    const minLockTime = time.duration.days(1);
    const maxLockTime = time.duration.days(4 * 31);

    const increase = ether("0.1");
    const increasePer = time.duration.days(31);

    await this.farmToken.mint(admin1, this.totalDist);
    const nextNonce = await web3.eth.getTransactionCount(admin1);
    const farmAddr = getDetAddr(admin1, nextNonce + 1);
    await this.farmToken.approve(farmAddr, this.totalDist, { from: admin1 });

    this.farm = await HoneyFarm.new(
      this.farmToken.address,
      [
        startTime,
        endTime,
        this.totalDist,
        endDistFrac,
        minLockTime,
        maxLockTime,
        increase.div(increasePer),
        SCALE,
        ether("0.0001"),
      ],
      { from: admin1 }
    );

    const refRewardRate = ether("0.1");
    this.rewardManager = await RewardManager.new(this.farmToken.address, refRewardRate, {
      from: admin1,
    });
    this.refDist = this.totalDist.mul(refRewardRate).div(SCALE);
    await this.farmToken.mint(this.rewardManager.address, this.refDist);

    this.gov = await GovernanceWrapper.new(
      this.farm.address,
      this.rewardManager.address,
      this.farmToken.address,
      { from: admin1 }
    );
    await this.farm.transferOwnership(this.gov.address, { from: admin1 });
    await this.rewardManager.transferOwnership(this.gov.address, { from: admin1 });
  });
  it("has correct admin role hash", async () => {
    this.ADMIN_ROLE = web3.utils.soliditySha3({
      type: "bytes",
      value: web3.utils.asciiToHex("honeyswap-farm.governance-wrapper.role.admin"),
    });
    expect(await this.gov.ADMIN_ROLE()).to.equal(this.ADMIN_ROLE);
  });
  it("has correct manager role hash", async () => {
    this.MANAGER_ROLE = web3.utils.soliditySha3({
      type: "bytes",
      value: web3.utils.asciiToHex("honeyswap-farm.governance-wrapper.role.manager"),
    });
    expect(await this.gov.MANAGER_ROLE()).to.equal(this.MANAGER_ROLE);
  });
  it("allows admin to grant manager role", async () => {
    await this.gov.grantRole(this.MANAGER_ROLE, manager1, { from: admin1 });
    expect(await this.gov.hasRole(this.MANAGER_ROLE, manager1)).to.be.true;
  });
  it("disallows setup call from non-admin", async () => {
    await expectRevert(this.gov.setup({ from: attacker1 }), "GovWrapper: not admin");
  });
  it("sets up farm and reward manager when setup() is called", async () => {
    expect(await this.farm.rewardManager()).to.equal(ZERO_ADDRESS);
    const receipt = await this.gov.setup({ from: admin1 });
    await expectEvent.inTransaction(receipt.tx, this.rewardManager, "FundsAccessGranted", {
      spender: this.gov.address,
    });
    await expectEvent.inTransaction(receipt.tx, this.rewardManager, "OwnershipTransferred", {
      previousOwner: this.gov.address,
      newOwner: this.farm.address,
    });
    await expectEvent.inTransaction(receipt.tx, this.farm, "RewardManagerSet", {
      rewardManager: this.rewardManager.address,
    });
  });
  it("disallows non-admin from transfering ownership", async () => {
    await expectRevert(
      this.gov.moveFarmOwnershipTo(attacker1, { from: attacker1 }),
      "GovWrapper: not admin"
    );
  });
  it("allows admin to transfer ownership", async () => {
    const receipt = await this.gov.moveFarmOwnershipTo(admin1, { from: admin1 });
    await expectEvent.inTransaction(receipt.tx, this.farm, "OwnershipTransferred", {
      previousOwner: this.gov.address,
      newOwner: admin1,
    });
    await this.farm.transferOwnership(this.gov.address, { from: admin1 });
  });
  it("disallows non-managers from modifying pools", async () => {
    await expectRevert(
      this.gov.modifyPools([], [], [], { from: admin1 }),
      "GovWrapper: not manager"
    );
    await expectRevert(
      this.gov.modifyPools([], [], [], { from: attacker1 }),
      "GovWrapper: not manager"
    );
  });
  it("allows managers to add tokens", async () => {
    this.tokens = [await TestERC20.new(), await TestERC20.new(), await TestERC20.new()];
    const weights = [ether("1"), ether("1")];
    const receipt = await this.gov.modifyPools(
      [this.tokens[0].address, this.tokens[1].address],
      weights,
      [true, true],
      { from: manager1 }
    );
    await expectEvent.inTransaction(receipt.tx, this.farm, "PoolAdded", {
      poolToken: this.tokens[0].address,
      allocation: weights[0],
    });
    await expectEvent.inTransaction(receipt.tx, this.farm, "PoolAdded", {
      poolToken: this.tokens[1].address,
      allocation: weights[1],
    });
  });
  it("allows managers to simultaneously add, modify and remove pools", async () => {
    const weights = [ether("2"), ZERO, ether("1")];
    const receipt = await this.gov.modifyPools(
      this.tokens.map(token => token.address),
      weights,
      [false, false, true],
      { from: manager1 }
    );
    await expectEvent.inTransaction(receipt.tx, this.farm, "PoolUpdated", {
      poolToken: this.tokens[0].address,
      allocation: weights[0],
    });
    await expectEvent.inTransaction(receipt.tx, this.farm, "PoolUpdated", {
      poolToken: this.tokens[1].address,
      allocation: weights[1],
    });
    await expectEvent.inTransaction(receipt.tx, this.farm, "PoolRemoved", {
      poolToken: this.tokens[1].address,
    });
    await expectEvent.inTransaction(receipt.tx, this.farm, "PoolAdded", {
      poolToken: this.tokens[2].address,
      allocation: weights[2],
    });
  });
  it("disallows non-admin from shutting down farm", async () => {
    await expectRevert(
      this.gov.shutdownFarming(attacker1, { from: attacker1 }),
      "GovWrapper: not admin"
    );
  });
  it("allows admin to shutdown farming", async () => {
    expect(await this.farmToken.balanceOf(shutdownRecipient1)).to.be.bignumber.equal(ZERO);
    const receipt = await this.gov.shutdownFarming(shutdownRecipient1, { from: admin1 });
    await expectEvent.inTransaction(receipt.tx, this.farm, "Disabled");
    expect(await this.farmToken.balanceOf(shutdownRecipient1)).to.be.bignumber.equal(
      this.totalDist.add(this.refDist)
    );
  });
  it("disallows non-manager from changing baseURI", async () => {
    await expectRevert(
      this.gov.setBaseURI("something nasty", { from: attacker1 }),
      "GovWrapper: not manager"
    );
  });
  it("allows managers to set baseURI", async () => {
    expect(await this.farm.baseURI()).to.equal("");
    const somePlaceholderURI = "https://1hive.org/#/home";
    await this.gov.setBaseURI(somePlaceholderURI, { from: manager1 });
    expect(await this.farm.baseURI()).to.equal(somePlaceholderURI);
  });
});

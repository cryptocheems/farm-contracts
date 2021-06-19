const { contract, accounts, web3 } = require("@openzeppelin/test-environment");
const { time, constants, expectEvent, expectRevert } = require("@openzeppelin/test-helpers");
const { MAX_UINT256 } = constants;
const { ZERO, trackBalance, ether, bnSum, expectEqualWithinFraction, bnE, safeBN } =
  require("./utils")(web3);
const { expect } = require("chai");
const BN = require("bn.js");

const [admin1, user1, user2, user3, user4, attacker1] = accounts;

const TestERC20 = contract.fromArtifact("TestERC20");
const StreamedAirdropper = contract.fromArtifact("StreamedAirdropper");

describe("StreamedAirdropper", () => {
  before(async () => {
    this.token = await TestERC20.new();
    const currentTime = await time.latest();
    this.start = currentTime.add(time.duration.days(2));
    this.end = this.start.add(time.duration.days(180));
    this.airdropper = await StreamedAirdropper.new(this.token.address, this.start, this.end);
  });
  it("starts with correct defaults", async () => {
    const userVesting = await this.airdropper.vestingUsers(user1);
    expect(userVesting.amountLeft).to.be.bignumber.equal(ZERO);
    expect(userVesting.lastWithdraw).to.be.bignumber.equal(ZERO);
  });
  it("can add vesting", async () => {
    const users = [user1, user2, user3];
    this.amounts = [ether("10"), ether("20"), ether("1.2")];
    const total = bnSum(...this.amounts);
    await this.token.mint(admin1, total.add(ether("100")));
    const adminBalTracker = await trackBalance(this.token, admin1);
    const airdropperTracker = await trackBalance(this.token, this.airdropper.address);
    await this.token.approve(this.airdropper.address, MAX_UINT256, { from: admin1 });

    const receipt = await this.airdropper.addVesting(users, this.amounts, { from: admin1 });
    for (let i = 0; i < users.length; i++) {
      expectEvent(receipt, "VestingAdded", { user: users[i], amount: this.amounts[i] });
    }
    expect(await adminBalTracker.delta()).to.be.bignumber.equal(total.neg());
    expect(await airdropperTracker.delta()).to.be.bignumber.equal(total);
  });
  it("does not overwrite values when vesting is added", async () => {
    // attack setup
    await this.token.mint(attacker1, ether("1"));
    const overwriteAmount = new BN("1");
    await this.token.approve(this.airdropper.address, overwriteAmount, { from: attacker1 });

    // attack
    const receipt = await this.airdropper.addVesting([user1], [overwriteAmount], {
      from: attacker1,
    });

    const userVesting = await this.airdropper.vestingUsers(user1);
    expectEvent(receipt, "VestingAdded", { user: user1, amount: overwriteAmount });
    expect(userVesting.amountLeft).to.be.bignumber.equal(this.amounts[0].add(overwriteAmount));

    // ensure that other tests work correctly
    this.amounts[0] = this.amounts[0].add(overwriteAmount);
  });
  it("cannot withdraw without vesting", async () => {
    await expectRevert(this.airdropper.withdraw({ from: attacker1 }), "SA: No pending tokens");
  });
  it("cannot withdraw when no tokens pending", async () => {
    expect(await this.airdropper.pendingTokens(user1)).to.be.bignumber.equal(ZERO);
    await expectRevert(this.airdropper.withdraw({ from: user1 }), "SA: No pending tokens");
  });
  it("increases pending tokens with time", async () => {
    // jump to middle
    const skipTo = this.start.add(this.end).div(new BN("2"));
    await time.increaseTo(skipTo);

    let userVesting = await this.airdropper.vestingUsers(user1);
    let pendingTokens = await this.airdropper.pendingTokens(user1);
    expectEqualWithinFraction(
      pendingTokens,
      userVesting.amountLeft.div(new BN("2")),
      new BN("1"),
      bnE("1", "6")
    );

    userVesting = await this.airdropper.vestingUsers(user2);
    pendingTokens = await this.airdropper.pendingTokens(user2);
    expectEqualWithinFraction(
      pendingTokens,
      userVesting.amountLeft.div(new BN("2")),
      new BN("1"),
      bnE("1", "6")
    );
  });
  it("allows direct withdraw", async () => {
    const pendingTokens = await this.airdropper.pendingTokens(user1);
    const tracker = await trackBalance(this.token, user1);
    const receipt = await this.airdropper.withdraw({ from: user1 });
    this.withdrawDelta = await tracker.delta();
    expectEqualWithinFraction(this.withdrawDelta, pendingTokens, new BN("1"), bnE("1", "6"));
    expectEvent(receipt, "Withdraw", {
      user: user1,
      recipient: user1,
      withdrawAmount: this.withdrawDelta,
    });
  });
  it("correctly updates vesting information after direct withdraw", async () => {
    const userVesting = await this.airdropper.vestingUsers(user1);
    const { timestamp } = await web3.eth.getBlock(await time.latestBlock());
    expect(userVesting.lastWithdraw).to.be.bignumber.equal(new BN(timestamp));
    expect(userVesting.amountLeft).to.be.bignumber.equal(this.amounts[0].sub(this.withdrawDelta));
  });
  it("allows withdraw to another address", async () => {
    const pendingTokens = await this.airdropper.pendingTokens(user2);
    const user2Tracker = await trackBalance(this.token, user2);
    const user3Tracker = await trackBalance(this.token, user3);
    const receipt = await this.airdropper.withdrawTo(user3, { from: user2 });
    this.withdrawDelta = await user3Tracker.delta();
    expectEqualWithinFraction(this.withdrawDelta, pendingTokens, new BN("1"), bnE("1", "6"));
    expect(await user2Tracker.delta()).to.be.bignumber.equal(ZERO);
    expectEvent(receipt, "Withdraw", {
      user: user2,
      recipient: user3,
      withdrawAmount: this.withdrawDelta,
    });
  });
  it("correctly updates vesting information after gifted withdraw", async () => {
    const user2Vesting = await this.airdropper.vestingUsers(user2);
    const { timestamp } = await web3.eth.getBlock(await time.latestBlock());
    expect(user2Vesting.lastWithdraw).to.be.bignumber.equal(new BN(timestamp));
    expect(user2Vesting.amountLeft).to.be.bignumber.equal(this.amounts[1].sub(this.withdrawDelta));
    const user3Vesting = await this.airdropper.vestingUsers(user3);
    expect(user3Vesting.lastWithdraw).to.be.bignumber.equal(ZERO);
    expect(user3Vesting.amountLeft).to.be.bignumber.equal(this.amounts[2]);
  });
  it("unlocks remaining tokens at vesting end", async () => {
    await time.increaseTo(this.end);
    const userVesting = await this.airdropper.vestingUsers(user1);
    const tracker = await trackBalance(this.token, user1);
    const receipt = await this.airdropper.withdraw({ from: user1 });
    expectEvent(receipt, "Withdraw", {
      user: user1,
      recipient: user1,
      withdrawAmount: userVesting.amountLeft,
    });
    expect(await tracker.delta()).to.be.bignumber.equal(userVesting.amountLeft);
  });
  it("unlocks remaining tokens passed vesting end", async () => {
    await time.increaseTo(this.end.add(time.duration.days(20)));
    const userVesting = await this.airdropper.vestingUsers(user2);
    const tracker = await trackBalance(this.token, user2);
    const receipt = await this.airdropper.withdrawTo(user2, { from: user2 });
    expectEvent(receipt, "Withdraw", {
      user: user2,
      recipient: user2,
      withdrawAmount: userVesting.amountLeft,
    });
    expect(await tracker.delta()).to.be.bignumber.equal(userVesting.amountLeft);
  });
  it("unlocks all tokens after vesting end for untouched vesting", async () => {
    const userVesting = await this.airdropper.vestingUsers(user3);
    // sanity check that vesting is actually untouched
    const expectedAmount = this.amounts[2];
    expect(userVesting.amountLeft).to.be.bignumber.equal(expectedAmount);
    const user3Tracker = await trackBalance(this.token, user3);
    const user4Tracker = await trackBalance(this.token, user4);
    const receipt = await this.airdropper.withdrawTo(user4, { from: user3 });
    expectEvent(receipt, "Withdraw", {
      user: user3,
      recipient: user4,
      withdrawAmount: expectedAmount,
    });
    expect(await user3Tracker.delta()).to.be.bignumber.equal(ZERO);
    expect(await user4Tracker.delta()).to.be.bignumber.equal(expectedAmount);
  });
  it("prevents withdrawals after end has been withdrawn", async () => {
    await expectRevert(this.airdropper.withdraw({ from: user1 }), "SA: No pending tokens");
  });
  it("gas usage", async () => {
    const totalDist = ether("1000000"); // 1 million

    const addVestingTo = async addresses => {
      const randomAddresses = [];
      const airdropAmount = totalDist.div(safeBN(addresses));
      for (let i = 0; i < addresses; i++) randomAddresses.push(web3.utils.randomHex(20));
      await this.token.mint(admin1, totalDist);
      const { receipt } = await this.airdropper.addVesting(
        randomAddresses,
        new Array(addresses).fill(airdropAmount),
        {
          from: admin1,
        }
      );
      console.log(
        `gas used: ${receipt.gasUsed} (${receipt.gasUsed / addresses} / user @${addresses} users)`
      );
    };

    await addVestingTo(5);
    await addVestingTo(20);
    await addVestingTo(30);
    await addVestingTo(40);
    await addVestingTo(100);
    await addVestingTo(300);
    await addVestingTo(400);
    await addVestingTo(500);
  });
});

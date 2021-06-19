const { contract, accounts, web3 } = require("@openzeppelin/test-environment");
const { time, constants, expectEvent, expectRevert } = require("@openzeppelin/test-helpers");
const { MAX_UINT256, ZERO_ADDRESS } = constants;
const {
  bnPerc,
  ether,
  getTxNonce,
  getDetAddr,
  ZERO,
  trackBalance,
  expectEqualWithinFraction,
  expectEqualWithinError,
  bnE,
} = require("./utils")(web3);
const { expect } = require("chai");
const BN = require("bn.js");

const [admin1, admin2, user1, user2, attacker1, attacker2] = accounts;

const HoneyFarm = contract.fromArtifact("HoneyFarm");
const CombToken = contract.fromArtifact("CombToken");
const RewardManager = contract.fromArtifact("RewardManager");
const TestERC20 = contract.fromArtifact("TestERC20");

describe("HoneyFarm", () => {
  const fundRewardManager = async () => {
    const fundAmount = this.totalDist.mul(this.refRewardRate).div(this.SCALE);
    await this.farmToken.transfer(this.rewardManager.address, fundAmount, { from: admin1 });
  };

  const depositRewards = async (rewards, from) => {
    await this.farmToken.transfer(this.rewardManager.address, rewards, { from });
    return await this.rewardManager.rebalance();
  };

  beforeEach(async () => {
    this.farmToken = await CombToken.new("xDai Native Comb", "xComb", { from: admin1 });

    this.SCALE = ether("1");
    this.minTime = time.duration.days(1);
    this.totalTime = time.duration.years(1);
    this.startDelta = time.duration.weeks(1);
    this.totalDist = bnPerc(await this.farmToken.totalSupply(), "50");
    this.endDistFrac = "20";
    const currentTime = await time.latest();
    this.startTime = currentTime.add(this.startDelta);
    this.endTime = this.startTime.add(this.totalTime);
    this.rewardFeeFraction = new BN("2000"); // 0.05%

    const nonce = await getTxNonce(this.farmToken.transactionHash);
    const farmAddr = getDetAddr(admin1, nonce + 2);
    await this.farmToken.approve(farmAddr, this.totalDist, { from: admin1 });

    this.farm = await HoneyFarm.new(
      this.farmToken.address,
      [
        this.startTime,
        this.endTime,
        this.totalDist,
        bnPerc(this.SCALE, this.endDistFrac),
        this.minTime,
        this.totalTime,
        bnPerc(this.SCALE, "2").div(time.duration.weeks(4)),
        this.SCALE,
        this.SCALE.div(this.rewardFeeFraction),
      ],
      { from: admin1 }
    );
    this.SCALE = await this.farm.SCALE();
    this.getFarmDist = async (start, end) =>
      (await this.farm.getDistribution(start, end)).div(this.SCALE);

    this.errorTime = time.duration.seconds(2);
    this.getDistError = edgeTime => this.getFarmDist(edgeTime, edgeTime.add(this.errorTime));
    this.maxError = await this.getDistError(this.startTime);
    expect(await this.farmToken.balanceOf(this.farm.address)).to.be.bignumber.equal(this.totalDist);
    this.refRewardRate = ether("0.2");
    this.rewardManager = await RewardManager.new(this.farmToken.address, this.refRewardRate, {
      from: admin1,
    });
    await this.rewardManager.transferOwnership(this.farm.address, { from: admin1 });
    await this.farm.setRewardManager(this.rewardManager.address, { from: admin1 });

    this.lpToken1 = await TestERC20.new();
    this.lpToken2 = await TestERC20.new();
  });
  describe("general", () => {
    beforeEach(async () => {
      await fundRewardManager();
    });
    it("calculates total distribution accurately", async () => {
      expect(await this.getFarmDist(this.startTime, this.endTime)).to.be.bignumber.equal(
        this.totalDist
      );
    });
    it("can add and remove pool", async () => {
      expect(await this.farm.poolLength()).to.be.bignumber.equal(ZERO);
      const allocation = new BN("20");
      await this.farm.add(this.lpToken1.address, allocation, {
        from: admin1,
      });

      expect(await this.farm.totalAllocationPoints()).to.be.bignumber.equal(allocation);
      expect(await this.farm.poolLength()).to.be.bignumber.equal(new BN("1"));

      const pool = await this.farm.poolInfo(this.lpToken1.address);
      expect(pool.allocation).to.be.bignumber.equal(allocation);
      expect(pool.accHsfPerShare).to.be.bignumber.equal(ZERO);
      expect(pool.totalShares).to.be.bignumber.equal(ZERO);
      expect(pool.lastRewardTimestamp).to.be.bignumber.equal(await this.farm.startTime());

      const receipt = await this.farm.set(this.lpToken1.address, ZERO, { from: admin1 });
      expectEvent(receipt, "PoolUpdated", { poolToken: this.lpToken1.address, allocation: ZERO });
      expectEvent(receipt, "PoolRemoved", { poolToken: this.lpToken1.address });
      expect(await this.farm.totalAllocationPoints()).to.be.bignumber.equal(ZERO);
      expect(await this.farm.poolLength()).to.be.bignumber.equal(ZERO);
    });
    it("updates pool correctly when entering and exiting", async () => {
      await expectRevert(
        this.farm.getPoolByIndex(new BN("0")),
        "EnumerableSet: index out of bounds"
      );
      // correct empty defaults
      const beforeAddPoolInfo = await this.farm.poolInfo(this.lpToken1.address);
      expect(beforeAddPoolInfo.allocation).to.be.bignumber.equal(ZERO);
      expect(beforeAddPoolInfo.lastRewardTimestamp).to.be.bignumber.equal(ZERO);
      expect(beforeAddPoolInfo.accHsfPerShare).to.be.bignumber.equal(ZERO);
      expect(beforeAddPoolInfo.totalShares).to.be.bignumber.equal(ZERO);

      // correctly adds pools
      let allocation = new BN("20");
      const poolToken = this.lpToken1.address;
      let receipt = await this.farm.add(poolToken, allocation, {
        from: admin1,
      });
      expectEvent(receipt, "PoolAdded", { poolToken, allocation });
      expectEvent.notEmitted(receipt, "PoolUpdated");
      await expectRevert(
        this.farm.add(poolToken, new BN("30"), { from: admin1 }),
        "HF: LP pool already exists"
      );

      // correct initialized defaults
      const startTime = await this.farm.startTime();
      let poolInfo = await this.farm.poolInfo(poolToken);
      expect(poolInfo.allocation).to.be.bignumber.equal(allocation);
      expect(poolInfo.lastRewardTimestamp).to.be.bignumber.equal(startTime);
      expect(poolInfo.accHsfPerShare).to.be.bignumber.equal(ZERO);
      expect(poolInfo.totalShares).to.be.bignumber.equal(ZERO);

      // open deposit
      await this.lpToken1.mint(user1, ether("60"));
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user1 });
      const deposit1 = ether("30");
      await this.farm.createDeposit(this.lpToken1.address, deposit1, ZERO, ZERO_ADDRESS, {
        from: user1,
      });

      // correctly updates after deposit added
      poolInfo = await this.farm.poolInfo(poolToken);
      expect(poolInfo.allocation).to.be.bignumber.equal(allocation);
      expect(poolInfo.lastRewardTimestamp).to.be.bignumber.equal(startTime);
      expect(poolInfo.accHsfPerShare).to.be.bignumber.equal(ZERO);
      expect(poolInfo.totalShares).to.be.bignumber.equal(deposit1);

      // open second deposit
      const deposit2 = ether("20");
      await this.farm.createDeposit(poolToken, deposit2, ZERO, ZERO_ADDRESS, { from: user1 });

      // correctly updates after another deposit is added
      poolInfo = await this.farm.poolInfo(poolToken);
      expect(poolInfo.allocation).to.be.bignumber.equal(allocation);
      expect(poolInfo.lastRewardTimestamp).to.be.bignumber.equal(startTime);
      expect(poolInfo.accHsfPerShare).to.be.bignumber.equal(ZERO);
      expect(poolInfo.totalShares).to.be.bignumber.equal(deposit1.add(deposit2));

      // allow rewards to accrue and update pools
      const skipTo = startTime.add(time.duration.days(2));
      await time.increaseTo(skipTo);
      const expectedRewardPerShare = (await this.farm.getDistribution(startTime, skipTo)).div(
        deposit1.add(deposit2)
      );
      const allowedShareError = (
        await this.farm.getDistribution(skipTo, skipTo.add(time.duration.seconds(2)))
      ).div(deposit1.add(deposit2));
      await this.farm.updatePool(poolToken);

      // correctly updates after rewards accrue
      poolInfo = await this.farm.poolInfo(poolToken);
      expect(poolInfo.allocation).to.be.bignumber.equal(allocation);
      expectEqualWithinError(poolInfo.lastRewardTimestamp, skipTo, time.duration.seconds(2));
      expectEqualWithinError(
        poolInfo.accHsfPerShare,
        expectedRewardPerShare,
        allowedShareError,
        "Incorrect rewards per share"
      );
      expect(poolInfo.totalShares).to.be.bignumber.equal(deposit1.add(deposit2));

      // change pool weight
      allocation = new BN("10");
      receipt = await this.farm.set(poolToken, allocation, { from: admin1 });
      expectEvent(receipt, "PoolUpdated", { poolToken, allocation });
      expectEvent.notEmitted(receipt, "PoolAdded");

      poolInfo = await this.farm.poolInfo(poolToken);
      expect(poolInfo.allocation).to.be.bignumber.equal(allocation);
      expectEqualWithinError(poolInfo.lastRewardTimestamp, skipTo, time.duration.seconds(2));
      expectEqualWithinError(poolInfo.accHsfPerShare, expectedRewardPerShare, allowedShareError);
      expect(poolInfo.totalShares).to.be.bignumber.equal(deposit1.add(deposit2));

      // closing a deposit
      await this.farm.closeDeposit(new BN("0"), { from: user1 });

      poolInfo = await this.farm.poolInfo(poolToken);
      expect(poolInfo.allocation).to.be.bignumber.equal(allocation);
      expectEqualWithinError(
        poolInfo.lastRewardTimestamp,
        skipTo,
        time.duration.seconds(2),
        "timestamp mismatch"
      );
      expectEqualWithinError(
        poolInfo.accHsfPerShare,
        expectedRewardPerShare,
        allowedShareError,
        "incorrect rewards per share"
      );
      expect(poolInfo.totalShares).to.be.bignumber.equal(deposit2);
    });
    it("can deposit LP tokens", async () => {
      expect(await this.farm.totalDeposits()).to.be.bignumber.equal(ZERO);

      // test setup
      await this.farm.add(this.lpToken1.address, new BN("20"), {
        from: admin1,
      });
      await this.lpToken1.mint(user1, ether("54"));
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user1 });
      const user1lp1 = await trackBalance(this.lpToken1, user1);
      const farmlp1 = await trackBalance(this.lpToken1, this.farm.address);

      // creating deposit
      const depositAmount1 = ether("21");
      let receipt = await this.farm.createDeposit(
        this.lpToken1.address,
        depositAmount1,
        ZERO,
        ZERO_ADDRESS,
        { from: user1 }
      );

      // general params
      expect(await user1lp1.delta()).to.be.bignumber.equal(depositAmount1.neg());
      expect(await farmlp1.delta()).to.be.bignumber.equal(depositAmount1);
      expect(await this.farm.totalDeposits()).to.be.bignumber.equal(new BN("1"));
      expect((await this.farm.poolInfo(this.lpToken1.address)).totalShares).to.be.bignumber.equal(
        depositAmount1
      );

      // deposit params
      expectEvent(receipt, "Transfer", { from: ZERO_ADDRESS, to: user1, tokenId: new BN("0") });
      const depositInfo1 = await this.farm.depositInfo(new BN("0"));
      expect(depositInfo1.amount).to.be.bignumber.equal(depositAmount1);
      expect(depositInfo1.rewardShare).to.be.bignumber.equal(depositAmount1);
      expect(depositInfo1.pool).to.equal(this.lpToken1.address);
      expect(depositInfo1.rewardDebt).to.be.bignumber.equal(ZERO);
      expect(depositInfo1.unlockTime).to.be.bignumber.equal(ZERO);

      // creating deposit
      const depositAmount2 = ether("11");
      receipt = await this.farm.createDeposit(
        this.lpToken1.address,
        depositAmount2,
        ZERO,
        ZERO_ADDRESS,
        { from: user1 }
      );

      // general params
      expect(await user1lp1.delta()).to.be.bignumber.equal(depositAmount2.neg());
      expect(await farmlp1.delta()).to.be.bignumber.equal(depositAmount2);
      expect(await this.farm.totalDeposits()).to.be.bignumber.equal(new BN("2"));
      expect((await this.farm.poolInfo(this.lpToken1.address)).totalShares).to.be.bignumber.equal(
        depositAmount1.add(depositAmount2)
      );

      // deposit params
      expectEvent(receipt, "Transfer", { from: ZERO_ADDRESS, to: user1, tokenId: new BN("1") });
      const depositInfo2 = await this.farm.depositInfo(new BN("1"));
      expect(depositInfo2.amount).to.be.bignumber.equal(depositAmount2);
      expect(depositInfo2.rewardShare).to.be.bignumber.equal(depositAmount2);
      expect(depositInfo2.pool).to.equal(this.lpToken1.address);
      expect(depositInfo2.rewardDebt).to.be.bignumber.equal(ZERO);
      expect(depositInfo2.unlockTime).to.be.bignumber.equal(ZERO);

      expect(await this.farm.pendingHsf(new BN("0"))).to.be.bignumber.equal(ZERO);
      expect(await this.farm.pendingHsf(new BN("1"))).to.be.bignumber.equal(ZERO);
    });
    it("can create, transfer and close deposit", async () => {
      await this.farm.add(this.lpToken1.address, new BN("20"), {
        from: admin1,
      });
      await this.lpToken1.mint(user1, ether("54"));
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user1 });

      const user2hsfTracker = await trackBalance(this.farmToken, user2);
      const user2lpTracker = await trackBalance(this.lpToken1, user2);

      const depositAmount = ether("34");
      await this.farm.createDeposit(this.lpToken1.address, depositAmount, ZERO, ZERO_ADDRESS, {
        from: user1,
      });
      const expectedDepositId = new BN("0");
      expect(await this.farm.ownerOf(expectedDepositId)).to.equal(user1);

      await time.increaseTo((await this.farm.startTime()).sub(time.duration.minutes(1)));

      let pendingHsf = await this.farm.pendingHsf(expectedDepositId);
      expect(pendingHsf).to.be.bignumber.equal(ZERO, "Initial pending HSF should be 0");

      await time.increaseTo(await this.farm.endTime());
      pendingHsf = await this.farm.pendingHsf(expectedDepositId);
      expectEqualWithinFraction(pendingHsf, this.totalDist, new BN("1"), ether("1"));

      let receipt = await this.farm.safeTransferFrom(user1, user2, expectedDepositId, {
        from: user1,
      });
      expectEvent(receipt, "Transfer", { from: user1, to: user2, tokenId: expectedDepositId });

      await expectRevert(
        this.farm.closeDeposit(expectedDepositId, { from: user1 }),
        "HF: Must be owner to withdraw"
      );

      receipt = await this.farm.closeDeposit(expectedDepositId, { from: user2 });
      expectEvent(receipt, "Transfer", {
        from: user2,
        to: ZERO_ADDRESS,
        tokenId: expectedDepositId,
      });
      expect(await user2hsfTracker.delta()).to.be.bignumber.equal(
        pendingHsf,
        "Withdrawer is expected to be accredited the pending rewards"
      );
      expect(await user2lpTracker.delta()).to.be.bignumber.equal(
        depositAmount,
        "Withdrawer is expected to retrieve his LP tokens"
      );
      await expectRevert(
        this.farm.ownerOf(expectedDepositId),
        "ERC721: owner query for nonexistent token"
      );
      const depositInfo = await this.farm.depositInfo(expectedDepositId);
      expect(depositInfo.amount).to.be.bignumber.equal(ZERO);
      expect(depositInfo.rewardDebt).to.be.bignumber.equal(ZERO);
      expect(depositInfo.unlockTime).to.be.bignumber.equal(ZERO);
      expect(depositInfo.rewardShare).to.be.bignumber.equal(ZERO);
      expect(depositInfo.setRewards).to.be.bignumber.equal(ZERO);
      expect(depositInfo.pool).to.equal(ZERO_ADDRESS);
      expect(depositInfo.referrer).to.equal(ZERO_ADDRESS);
    });
    it("distributes proportional to deposit size", async () => {
      await this.farm.add(this.lpToken1.address, new BN("20"), {
        from: admin1,
      });

      const mintAmount1 = ether("10");
      await this.lpToken1.mint(user1, mintAmount1);
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user1 });
      const user1Tracker = await trackBalance(this.farmToken, user1);

      const mintAmount2 = mintAmount1.mul(new BN("2"));
      await this.lpToken1.mint(user2, mintAmount2);
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user2 });
      const user2Tracker = await trackBalance(this.farmToken, user2);

      let receipt = await this.farm.createDeposit(
        this.lpToken1.address,
        mintAmount1,
        ZERO,
        ZERO_ADDRESS,
        {
          from: user1,
        }
      );
      expectEvent(receipt, "Transfer", { from: ZERO_ADDRESS, to: user1, tokenId: new BN("0") });

      receipt = await this.farm.createDeposit(
        this.lpToken1.address,
        mintAmount2,
        ZERO,
        ZERO_ADDRESS,
        {
          from: user2,
        }
      );
      expectEvent(receipt, "Transfer", { from: ZERO_ADDRESS, to: user2, tokenId: new BN("1") });

      await time.increaseTo(await this.farm.endTime());

      await this.farm.closeDeposit(new BN("0"), { from: user1 });
      await this.farm.closeDeposit(new BN("1"), { from: user2 });

      expect((await user1Tracker.delta()).mul(new BN("2"))).to.be.bignumber.equal(
        await user2Tracker.delta(),
        "rewards mismatch"
      );

      const totalRewards = (await user1Tracker.get()).add(await user2Tracker.get());
      expectEqualWithinFraction(
        totalRewards,
        this.totalDist,
        new BN("1"),
        ether("1"),
        "total rewards mismatch"
      );
    });
    it("keeps track of duration in pool for deposits", async () => {
      await this.farm.add(this.lpToken1.address, new BN("20"), {
        from: admin1,
      });

      const mintAmount1 = ether("10");
      await this.lpToken1.mint(user1, mintAmount1);
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user1 });
      const user1Tracker = await trackBalance(this.farmToken, user1);

      const mintAmount2 = mintAmount1.mul(new BN("2"));
      await this.lpToken1.mint(user2, mintAmount2);
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user2 });
      const user2Tracker = await trackBalance(this.farmToken, user2);

      const totalMinted = mintAmount1.add(mintAmount2);

      await this.farm.createDeposit(this.lpToken1.address, mintAmount1, ZERO, ZERO_ADDRESS, {
        from: user1,
      });

      const third = this.totalTime.div(new BN("3"));
      const startTime = await this.farm.startTime();

      await time.increaseTo(startTime.add(third));
      await this.farm.createDeposit(this.lpToken1.address, mintAmount2, ZERO, ZERO_ADDRESS, {
        from: user2,
      });

      const depositInfo2 = await this.farm.depositInfo(new BN("1"));
      expect(depositInfo2.amount).to.be.bignumber.equal(mintAmount2);
      expect(depositInfo2.rewardShare).to.be.bignumber.equal(mintAmount2);
      const firstThirdDist = await this.farm.getDistribution(startTime, startTime.add(third));
      const convDebt = depositInfo2.rewardDebt.mul(mintAmount1).div(mintAmount2);
      expectEqualWithinFraction(
        convDebt,
        firstThirdDist.div(this.SCALE),
        new BN("1"),
        bnE("1", "6"),
        "Reward debt doesn't displace accrued total rewards"
      );

      const twoThirdsTime = startTime.add(third).add(third);
      await time.increaseTo(twoThirdsTime);
      await this.farm.closeDeposit(new BN("1"), { from: user2 });

      const middleThirdDist = await this.farm.getDistribution(startTime.add(third), twoThirdsTime);
      const user2Share = middleThirdDist.mul(mintAmount2).div(totalMinted);
      expectEqualWithinFraction(
        await user2Tracker.delta(),
        user2Share.div(this.SCALE),
        new BN("1"),
        bnE("1", "6"),
        "User withdrawing inbetween didn't receive expected reward"
      );

      const endTime = await this.farm.endTime();
      await time.increaseTo(endTime);
      await this.farm.closeDeposit(new BN("0"), { from: user1 });
      const lastThirdDist = await this.farm.getDistribution(twoThirdsTime, endTime);
      const user1MiddleShare = middleThirdDist.mul(mintAmount1).div(totalMinted);
      expectEqualWithinFraction(
        await user1Tracker.delta(),
        firstThirdDist.add(user1MiddleShare).add(lastThirdDist).div(this.SCALE),
        new BN("1"),
        bnE("1", "6"),
        "Last user didn't receive remaining rewards"
      );
    });
  });
  describe("deposit creation and management", () => {
    beforeEach(async () => {
      this.poolToken = this.lpToken1.address;
      await this.farm.add(this.poolToken, new BN("20"), { from: admin1 });
      this.mintAmount = ether("10");
      this.expectedDowngradeReward = this.mintAmount.div(this.rewardFeeFraction);
      await this.lpToken1.mint(user1, this.mintAmount);
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user1 });
    });
    describe("disabling", () => {
      beforeEach(async () => {
        // setup deposit params
        this.depositDuration = time.duration.days(180);
        this.depositStart = this.startTime;
        this.depositEnd = this.depositStart.add(this.depositDuration);
        this.halfwayPoint = this.depositStart.add(this.depositDuration.div(new BN("2")));
        const receipt = await this.farm.createDeposit(
          this.poolToken,
          this.mintAmount,
          this.depositEnd,
          ZERO_ADDRESS,
          { from: user1 }
        );
        this.depositId = receipt.logs[0].args.tokenId;
        // jump to half way point
        await time.increaseTo(this.halfwayPoint);
      });
      it("non-admin cannot disable", async () => {
        await expectRevert(
          this.farm.disableContract(attacker2, { from: attacker1 }),
          "Ownable: caller is not the owner"
        );
      });
      it("cannot close before disable", async () => {
        await expectRevert(
          this.farm.closeDeposit(this.depositId, { from: user1 }),
          "HF: Deposit still locked"
        );
      });
      it("allows admin to disable contract", async () => {
        const expectedDist = await this.getFarmDist(this.halfwayPoint, this.endTime);
        const allowedDistError = await this.getDistError(this.halfwayPoint);
        const receipt = await this.farm.disableContract(admin2, { from: admin1 });
        expectEvent(receipt, "Disabled", {});
        expectEqualWithinError(
          await this.farmToken.balanceOf(admin2),
          expectedDist,
          allowedDistError,
          "doesn't receive remaining tokens"
        );
      });
      it("prevents creation of new deposits", async () => {
        await this.farm.disableContract(admin2, { from: admin1 });
        const newDepositAmount = ether("12");
        await this.lpToken1.mint(user2, newDepositAmount);
        await this.lpToken1.approve(this.farm.address, MAX_UINT256);
        await expectRevert(
          this.farm.createDeposit(this.poolToken, newDepositAmount, ZERO, ZERO_ADDRESS, {
            from: user2,
          }),
          "HF: Contract already disabled"
        );
      });
      it("still gets rewards", async () => {
        const expectedDist = await this.getFarmDist(this.startTime, this.halfwayPoint);
        const allowedDistError = await this.getDistError(this.halfwayPoint);
        await this.farm.disableContract(admin2, { from: admin1 });
        await this.farm.withdrawRewards(this.depositId, { from: user1 });
        expectEqualWithinError(
          await this.farmToken.balanceOf(user1),
          expectedDist,
          allowedDistError
        );
      });
      it("doesn't accumulate rewards for deposits after disable", async () => {
        await this.farm.disableContract(admin2, { from: admin1 });
        await this.farm.withdrawRewards(this.depositId, { from: user1 });
        await time.increase(time.duration.days(10));
        expect(await this.farm.pendingHsf(this.depositId)).to.be.bignumber.equal(ZERO);
        expect(await time.latest()).to.be.bignumber.below(this.depositEnd);
        await this.farm.closeDeposit(this.depositId, { from: user1 });
      });
    });
    it("prevents deposits with too short lock-times from being created", async () => {
      await time.increaseTo(this.startTime);
      const depositEnd = this.startTime.add(this.minTime).sub(time.duration.minutes(1));
      await expectRevert(
        this.farm.createDeposit(this.poolToken, this.mintAmount, depositEnd, ZERO_ADDRESS),
        "HF: Lock time too short"
      );
    });
    it("prevents deposits with 0 amount from being created", async () => {
      const depositDuration = time.duration.days(60);
      const depositEnd = (await time.latest()).add(depositDuration);
      await expectRevert(
        this.farm.createDeposit(this.poolToken, ZERO, depositEnd, ZERO_ADDRESS, { from: user1 }),
        "HF: Must deposit something"
      );
    });
    it("correctly initializes time-locked deposit before reward distribution begin", async () => {
      // setup
      const user1Tracker = await trackBalance(this.lpToken1, user1);

      // creating deposit
      const depositDuration = time.duration.days(60);
      const depositEnd = (await time.latest()).add(depositDuration);
      const expectedDepositId = new BN("0");
      const expectedMultiplier = await this.farm.getTimeMultiple(depositEnd);
      const expectedShares = this.mintAmount.mul(expectedMultiplier).div(this.SCALE);
      let receipt = await this.farm.createDeposit(
        this.poolToken,
        this.mintAmount,
        depositEnd,
        ZERO_ADDRESS,
        { from: user1 }
      );

      // verify creation
      expectEvent(receipt, "Transfer", {
        from: ZERO_ADDRESS,
        to: user1,
        tokenId: expectedDepositId,
      });
      expect(await user1Tracker.delta()).to.be.bignumber.equal(
        this.mintAmount.neg(),
        "no tokens deducted"
      );

      // verify new deposit params
      const depositInfo = await this.farm.depositInfo(expectedDepositId);
      expect(depositInfo.amount).to.be.bignumber.equal(this.mintAmount, "deposit amount no stored");
      expect(depositInfo.rewardDebt).to.be.bignumber.equal(ZERO);
      expect(depositInfo.unlockTime).to.be.bignumber.equal(depositEnd);
      expectEqualWithinFraction(
        depositInfo.rewardShare,
        expectedShares,
        new BN("1"),
        bnE("1", "6")
      );
      expect(depositInfo.setRewards).to.be.bignumber.equal(ZERO);
      expect(depositInfo.pool).to.equal(this.poolToken);
      expect(depositInfo.referrer).to.equal(ZERO_ADDRESS);
    });
    it("allows downgrading deposit who's time-lock has expired", async () => {
      const user1PoolTracker = await trackBalance(this.lpToken1, user1);
      const user1xCombTracker = await trackBalance(this.farmToken, user1);
      const user2PoolTracker = await trackBalance(this.lpToken1, user2);
      const user2xCombTracker = await trackBalance(this.farmToken, user2);

      const depositDuration = time.duration.days(60);
      const depositEnd = (await time.latest()).add(depositDuration);
      const depositId = new BN("0");
      await this.farm.createDeposit(this.poolToken, this.mintAmount, depositEnd, ZERO_ADDRESS, {
        from: user1,
      });
      await user1xCombTracker.reset();
      await user1PoolTracker.reset();

      // too early downgrade
      await expectRevert(
        this.farm.downgradeExpired(depositId, { from: attacker1 }),
        "HF: deposit has not expired yet"
      );

      // correct downgrade
      await time.increaseTo(depositEnd);
      let receipt = await this.farm.downgradeExpired(depositId, { from: user2 });

      expectEvent(receipt, "DepositDowngraded", {
        downgrader: user2,
        depositId,
        downgradeReward: this.expectedDowngradeReward,
      });

      const poolInfo = await this.farm.poolInfo(this.poolToken);
      expect(poolInfo.totalShares).to.be.bignumber.equal(this.mintAmount);

      const expectedDebt = poolInfo.accHsfPerShare.mul(this.mintAmount).div(this.SCALE);
      const expectedRewards = await this.farm.getDistribution(
        this.startTime,
        poolInfo.lastRewardTimestamp
      );

      expect(await user1PoolTracker.delta()).to.be.bignumber.equal(ZERO);
      expect(await user1xCombTracker.delta()).to.be.bignumber.equal(ZERO);
      expect(await user2PoolTracker.delta()).to.be.bignumber.equal(this.expectedDowngradeReward);
      expect(await user2xCombTracker.delta()).to.be.bignumber.equal(ZERO);
      const depositInfo = await this.farm.depositInfo(depositId);
      expect(depositInfo.amount).to.be.bignumber.equal(
        this.mintAmount.sub(this.expectedDowngradeReward),
        "wrong amount"
      );
      expect(depositInfo.rewardDebt).to.be.bignumber.equal(expectedDebt, "wrong reward debt");
      expect(depositInfo.unlockTime).to.be.bignumber.equal(ZERO);
      expect(depositInfo.rewardShare).to.be.bignumber.equal(this.mintAmount, "wrong share");
      expectEqualWithinFraction(
        depositInfo.setRewards,
        expectedRewards.div(this.SCALE),
        new BN("1"),
        bnE("1", "6"),
        "wrong set rewards"
      );
      expect(depositInfo.pool).to.be.bignumber.equal(this.poolToken);
      expect(depositInfo.referrer).to.be.bignumber.equal(ZERO_ADDRESS);

      // skip a little forward
      const forwardSkip = time.duration.days(2);
      const targetTime = depositEnd.add(forwardSkip);
      await time.increaseTo(targetTime);

      await expectRevert(
        this.farm.downgradeExpired(depositId, { from: attacker1 }),
        "HF: no lock to expire"
      );
      receipt = await this.farm.closeDeposit(depositId, { from: user1 });

      // check successful closing
      expectEvent(receipt, "Transfer", { from: user1, to: ZERO_ADDRESS, tokenId: depositId });
      await expectRevert(this.farm.ownerOf(depositId), "ERC721: owner query for nonexistent token");
      expect(await user1PoolTracker.delta()).to.be.bignumber.equal(
        this.mintAmount.sub(this.expectedDowngradeReward)
      );
      expectEqualWithinError(
        await user1xCombTracker.delta(),
        (await this.farm.getDistribution(this.startTime, targetTime)).div(this.SCALE),
        this.maxError
      );
    });
    it("allows withdrawing pending rewards from locked deposit", async () => {
      const user1PoolTracker = await trackBalance(this.lpToken1, user1);
      const user1xCombTracker = await trackBalance(this.farmToken, user1);

      const depositDuration = time.duration.days(60);
      const depositEnd = (await time.latest()).add(depositDuration);
      const midPoint = depositEnd.sub(depositDuration.div(new BN("2")));
      const depositId = new BN("0");
      await this.farm.createDeposit(this.poolToken, this.mintAmount, depositEnd, ZERO_ADDRESS, {
        from: user1,
      });
      await user1xCombTracker.reset();
      await user1PoolTracker.reset();

      // jump to half way point
      await time.increaseTo(midPoint);

      await expectRevert(
        this.farm.withdrawRewards(depositId, { from: attacker1 }),
        "HF: Must be owner of deposit"
      );

      let pendingRewards = await this.farm.pendingHsf(depositId);
      let receipt = await this.farm.withdrawRewards(depositId, { from: user1 });
      const receivedRewards = await user1xCombTracker.delta();
      expectEvent(receipt, "RewardsWithdraw", { depositId, rewardAmount: receivedRewards });
      expectEqualWithinFraction(
        receivedRewards,
        pendingRewards,
        new BN("1"),
        bnE("1", "6"),
        "didn't receive pending rewards"
      );
      expect(await user1PoolTracker.delta()).to.be.bignumber.equal(ZERO, "received pool tokens");
      expectEvent.notEmitted(receipt, "DepositDowngraded");
      pendingRewards = await this.farm.pendingHsf(depositId);
      expectEqualWithinError(
        pendingRewards,
        ZERO,
        this.maxError,
        "rewards still pending after withdraw"
      );

      // jump to end
      await time.increaseTo(depositEnd);
      pendingRewards = await this.farm.pendingHsf(depositId);
      receipt = await this.farm.withdrawRewards(depositId, { from: user1 });
      expectEqualWithinFraction(
        await user1xCombTracker.delta(),
        pendingRewards,
        new BN("1"),
        bnE("1", "6"),
        "wrong rewards received"
      );
      expect(await user1PoolTracker.delta()).to.be.bignumber.equal(
        this.expectedDowngradeReward,
        "received pool tokens"
      );
      expect(receipt, "DepositDowngraded", {
        downgrader: user1,
        depositId,
        downgradeReward: this.expectedDowngradeReward,
      });
      pendingRewards = await this.farm.pendingHsf(depositId);
      expectEqualWithinError(pendingRewards, ZERO, this.maxError, "still has pending rewards");

      expectEqualWithinFraction(
        await user1xCombTracker.get(),
        (await this.farm.getDistribution(this.startTime, depositEnd)).div(this.SCALE),
        new BN("1"),
        bnE("1", "6"),
        "expect received total rewards match distribution"
      );

      // still acrues withdrawable rewards after downgrade
      await time.increase(time.duration.days(20));
      pendingRewards = await this.farm.pendingHsf(depositId);
      receipt = await this.farm.withdrawRewards(depositId, { from: user1 });
      expectEqualWithinFraction(
        await user1xCombTracker.delta(),
        pendingRewards,
        new BN("1"),
        bnE("1", "6")
      );
      expect(await user1PoolTracker.delta()).to.be.bignumber.equal(ZERO, "received pool tokens");
      expectEvent.notEmitted(receipt, "DepositDowngraded");
      pendingRewards = await this.farm.pendingHsf(depositId);
      expectEqualWithinError(pendingRewards, ZERO, this.maxError, "still has pending rewards (1)");

      // close deposit
      await time.increase(time.duration.days(20));
      pendingRewards = await this.farm.pendingHsf(depositId);
      receipt = await this.farm.closeDeposit(depositId, { from: user1 });
      expectEqualWithinFraction(
        await user1xCombTracker.delta(),
        pendingRewards,
        new BN("1"),
        bnE("1", "6"),
        "still has pending rewards (2)"
      );
      expect(await user1PoolTracker.delta()).to.be.bignumber.equal(
        this.mintAmount.sub(this.expectedDowngradeReward)
      );
      expectEvent(receipt, "Transfer", { from: user1, to: ZERO_ADDRESS, tokenId: depositId });

      await expectRevert(
        this.farm.withdrawRewards(depositId, { from: user1 }),
        "ERC721: owner query for nonexistent token"
      );
    });
  });
  describe("referral rewards", () => {
    beforeEach(async () => {
      this.poolToken = this.lpToken1.address;
      await this.farm.add(this.poolToken, new BN("20"), { from: admin1 });
      this.mintAmount = ether("10");
      await this.lpToken1.mint(user1, this.mintAmount);
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user1 });
    });
    it("allows no referral", async () => {
      const receipt = await this.farm.createDeposit(
        this.poolToken,
        this.mintAmount,
        ZERO,
        ZERO_ADDRESS,
        { from: user1 }
      );
      expectEvent.notEmitted(receipt, "Referred");
    });
    it("credits referrer with reward upon closing deposit", async () => {
      await fundRewardManager();

      const referrer = user2;
      const user1Tracker = await trackBalance(this.farmToken, user1);
      const referrerTracker = await trackBalance(this.farmToken, referrer);

      let receipt = await this.farm.createDeposit(this.poolToken, this.mintAmount, ZERO, referrer, {
        from: user1,
      });
      const depositId = new BN("0");
      expectEvent(receipt, "Referred", { referrer, depositId });

      const timeSkip = time.duration.days(2);
      await time.increaseTo(this.startTime.add(timeSkip));

      receipt = await this.farm.closeDeposit(depositId, { from: user1 });
      const userReward = await user1Tracker.delta();
      const expectedRefReward = userReward.mul(this.refRewardRate).div(this.SCALE);
      expect(await referrerTracker.delta()).to.be.bignumber.equal(expectedRefReward);
    });
    it("doesn't revert if referrer runs out of rewards", async () => {
      const timeSkip = time.duration.days(2);

      // fill reward referrer only with half of the required rewards
      const estRewards = (
        await this.farm.getDistribution(this.startTime, this.startTime.add(timeSkip))
      )
        .mul(this.refRewardRate)
        .div(this.SCALE)
        .div(this.SCALE);
      const refReserves = bnPerc(estRewards, "50");
      await this.farmToken.transfer(this.rewardManager.address, refReserves, {
        from: admin1,
      });

      const referrer = user2;
      const user1Tracker = await trackBalance(this.farmToken, user1);
      const referrerTracker = await trackBalance(this.farmToken, referrer);

      await this.farm.createDeposit(this.poolToken, this.mintAmount, ZERO, referrer, {
        from: user1,
      });
      const depositId = new BN("0");

      await time.increaseTo(this.startTime.add(timeSkip));

      const receipt = await this.farm.closeDeposit(depositId, { from: user1 });
      const userReward = await user1Tracker.delta();
      const expectedTotalReward = userReward.mul(this.refRewardRate).div(this.SCALE);
      const refReward = await referrerTracker.delta();
      expect(refReward).to.be.bignumber.equal(refReserves);
      await expectEvent.inTransaction(receipt.tx, this.rewardManager, "MissingReward", {
        referrer,
        owedReward: expectedTotalReward.sub(refReward),
      });
    });
  });
  describe("adding additional rewards", () => {
    it("accounts additional rewards", async () => {
      await fundRewardManager();
      const addedRewards = ether("400");

      const token1 = await TestERC20.new();
      await token1.mint(user1, ether("200"));
      await token1.approve(this.farm.address, MAX_UINT256, { from: user1 });
      await this.farm.add(token1.address, new BN("20"), { from: admin1 });

      const token2 = await TestERC20.new();
      await token2.mint(user1, ether("100"));
      await token2.approve(this.farm.address, MAX_UINT256, { from: user1 });
      await this.farm.add(token2.address, new BN("20"), { from: admin1 });

      await this.farm.createDeposit(token1.address, ether("100"), ZERO, ZERO_ADDRESS, {
        from: user1,
      });
      await this.farm.createDeposit(token2.address, ether("100"), ZERO, ZERO_ADDRESS, {
        from: user1,
      });
      await this.farm.createDeposit(token1.address, ether("100"), ZERO, ZERO_ADDRESS, {
        from: user1,
      });

      const receipt = await depositRewards(addedRewards, admin1);
      const expectedReward = addedRewards.mul(this.SCALE).div(this.SCALE.add(this.refRewardRate));
      await expectEvent.inTransaction(receipt.tx, this.farm, "RewardsAdded", {
        additionalRewardAmount: expectedReward,
      });

      expectEqualWithinError(
        await this.farm.pendingHsf(new BN("0")),
        expectedReward.div(new BN("4")),
        bnE("1", "4"),
        "incorrect deposit 0 rewards"
      );
      expectEqualWithinError(
        await this.farm.pendingHsf(new BN("1")),
        expectedReward.div(new BN("2")),
        bnE("1", "4"),
        "incorrect deposit 1 rewards"
      );
      expectEqualWithinError(
        await this.farm.pendingHsf(new BN("2")),
        expectedReward.div(new BN("4")),
        bnE("1", "4"),
        "incorrect deposit 2 rewards"
      );
    });
  });
  describe("gas usage", () => {
    it("adding pools, adding rewards and rebalancing", async () => {
      await fundRewardManager();

      const testTokens = [];
      const addPools = async newPools => {
        for (let i = 0; i < newPools; i++) {
          const newTestToken = await TestERC20.new();
          testTokens.push(newTestToken);
          const poolToken = newTestToken.address;
          const { receipt } = await this.farm.add(poolToken, new BN("10"), {
            from: admin1,
          });
          const depositAmount = ether("100");
          await newTestToken.mint(user1, depositAmount);
          await newTestToken.approve(this.farm.address, MAX_UINT256, { from: user1 });
          await this.farm.createDeposit(poolToken, depositAmount, ZERO, ZERO_ADDRESS, {
            from: user1,
          });
          console.log(`gas used to add pool ${testTokens.length}. : ${receipt.gasUsed}`);
        }
      };
      await addPools(20);
      const { receipt: receipt1 } = await depositRewards(ether("1200"), admin1);
      console.log(`\ndepositing rewards gas cost with 20 pools: ${receipt1.gasUsed}\n`);
      const { receipt: receipt2 } = await depositRewards(ether("1200"), admin1);
      console.log(`\ndepositing rewards gas cost with 20 pools (2nd time): ${receipt2.gasUsed}\n`);
      await addPools(20);
      const { receipt: receipt3 } = await depositRewards(ether("1200"), admin1);
      console.log(`\ndepositing rewards gas cost with 40 pools: ${receipt3.gasUsed}`);
      const { receipt: receipt4 } = await depositRewards(ether("1200"), admin1);
      console.log(`\ndepositing rewards gas cost with 40 pools (2nd time): ${receipt4.gasUsed}`);
    });
  });
});

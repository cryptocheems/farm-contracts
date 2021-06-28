// SPDX-License-Identifier: GPL-3.0-only
// https://cheemsco.in/farm
// https://github.com/cryptocheems/farm-contracts
pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Forked from the HoneyFarm v1 contract
// https://github.com/1Hive/honeyswap-farm/blob/master/contracts/HoneyFarm.sol
contract CheemscoinFarm is Ownable, ERC721 {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;
  using EnumerableSet for EnumerableSet.AddressSet;

  // Info of each deposit
  struct DepositInfo {
    uint256 amount; // How many LP tokens the user has provided.
    uint256 rewardDebt; // Reward debt (value of accumulator)
    uint256 unlockTime;
    uint256 rewardShare;
    uint256 setRewards;
    IERC20 pool;
  }

  // Info of each pool.
  struct PoolInfo {
    uint256 allocation; // How many allocation points assigned to this pool.
    // Last block timestamp that HSFs distribution occured, initially set to the startTime.
    uint256 lastRewardTimestamp;
    uint256 accHsfPerShare; // Accumulated HSFs per share, times SCALE.
    uint256 totalShares; // total shares stored in pool
  }

  // Frontend view of pools
  struct PoolDetails {
    IERC20 poolToken;
    uint256 allocation;
    uint256 lastRewardTimestamp;
    uint256 accHsfPerShare;
    uint256 totalShares;
  }

  // Frontend view of deposit
  struct DepositDetails {
    IERC20 poolToken;
    uint256 balance; // Amount of LP tokens  deposited
    uint256 unlockTime;
    uint256 pendingReward; // Cheems not paid yet
  }

  // What fractional numbers are scaled by
  uint256 public constant SCALE = 1e18;
  // The Farm token
  IERC20 public immutable hsf;
  // Info of each pool.
  mapping(IERC20 => PoolInfo) public poolInfo;
  // set of running pools
  EnumerableSet.AddressSet internal pools;
  // Total allocation points. Must be the sum of all allocation points in all pools.
  uint256 public totalAllocationPoints;
  // total deposits
  uint256 public totalDeposits;
  // data about infdividual deposits
  mapping(uint256 => DepositInfo) public depositInfo;
  /* the negative slope of the distribution line scaled by SCALE, how much
  less is being distributed per unit of time. */
  uint256 public immutable distributionSlope;
  // starting distribution rate / unit time scaled by SCALE
  uint256 public immutable startDistribution;
  // minimum time someone can lock their liquidity for
  uint256 public immutable minTimeLock;
  // maximum time someone can lock their liquidity for
  uint256 public immutable maxTimeLock;
  // time at which coins begin being distributed
  uint256 public immutable startTime;
  // time at which coins finish being distributed
  uint256 public immutable endTime;
  // multiplier for time locked deposits / second locked scaled by SCALE
  uint256 public immutable timeLockMultiplier;
  // constant added to the timeLockMultiplier scaled by SCALE
  uint256 public immutable timeLockConstant;
  /* One time fee that is deducted from time-locked deposits given to whoever
  downgrades it, scaled by SCALE */
  uint256 public immutable downgradeFee;
  // whether this contract has been disabled
  uint256 public contractDisabledAt;

  event PoolAdded(IERC20 indexed poolToken, uint256 allocation);
  // fired when pool parameters are updated not when the updatePool() method is called
  event PoolUpdated(IERC20 indexed poolToken, uint256 allocation);
  event PoolRemoved(IERC20 indexed poolToken);
  event Disabled();
  event DepositDowngraded(
    address indexed downgrader,
    uint256 indexed depositId,
    uint256 downgradeReward
  );
  event RewardsWithdraw(uint256 indexed depositId, uint256 rewardAmount);
  event RewardsAdded(uint256 additionalRewardAmount);

  // parameters passed as byte strings to mitigate stack too deep error
  constructor(
    IERC20 _hsf,
    // uint256 _startTime,
    // uint256 _endTime,
    // uint256 _totalHsfToDistribute,
    // uint256 _endDistributionFraction,
    // uint256 _minTimeLock,
    // uint256 _maxTimeLock,
    // uint256 _timeLockMultiplier,
    // uint256 _timeLockConstant,
    // uint256 _downgradeFee
    uint256[9] memory _parameters
  ) ERC721("CheemsFarm Deposit v1", "CFD") {
    uint256 _startTime = _parameters[0];
    uint256 _endTime = _parameters[1];
    require(_endTime > _startTime, "HF: endTime before startTime");
    uint256 _totalHsfToDistribute = _parameters[2];
    uint256 _endDistributionFraction = _parameters[3];
    hsf = _hsf;
    startTime = _startTime;
    endTime = _endTime;
    _hsf.safeTransferFrom(msg.sender, address(this), _totalHsfToDistribute);

    // check https://hackmd.io/BFrhyOTUQ3O9REs5PuZahQ for a breakdown of the maths
    // ds = (2 * s) / (te * (r + 1))
    uint256 startDistribution_ = _totalHsfToDistribute.mul(2).mul(SCALE).mul(SCALE).div(
      (_endTime - _startTime).mul(_endDistributionFraction.add(SCALE))
    );
    // -m = ds * (1 - r) / te
    distributionSlope = startDistribution_.mul(SCALE.sub(_endDistributionFraction)).div(
      (_endTime - _startTime).mul(SCALE)
    );
    startDistribution = startDistribution_;

    uint256 _minTimeLock = _parameters[4];
    uint256 _maxTimeLock = _parameters[5];
    require(_minTimeLock < _maxTimeLock, "HF: invalid lock limits");
    minTimeLock = _minTimeLock;
    maxTimeLock = _maxTimeLock;
    timeLockMultiplier = _parameters[6];
    timeLockConstant = _parameters[7];
    downgradeFee = _parameters[8];
  }

  modifier notDisabled {
    require(contractDisabledAt == 0, "HF: Contract already disabled");
    _;
  }

  function poolLength() external view returns (uint256) {
    return pools.length();
  }

  function getPoolByIndex(uint256 _index) public view returns (PoolDetails memory) {
    IERC20 poolToken = IERC20(pools.at(_index));
    PoolInfo memory pool = poolInfo[poolToken];
    return
      PoolDetails(
        poolToken,
        pool.allocation,
        pool.lastRewardTimestamp,
        pool.accHsfPerShare,
        pool.totalShares
      );
  }

  function getAllPools() external view returns (PoolDetails[] memory) {
    PoolDetails[] memory allPools = new PoolDetails[](pools.length());
    for (uint256 i = 0; i < pools.length(); i++) {
      allPools[i] = getPoolByIndex(i);
    }
    return allPools;
  }

  function getAccountDeposits(address _account) external view returns (DepositDetails[] memory) {
    DepositDetails[] memory allDeposits = new DepositDetails[](balanceOf(_account));
    for (uint256 i = 0; i < balanceOf(_account); i++) {
      uint256 depositIndex = tokenOfOwnerByIndex(_account, i);
      DepositInfo memory d = depositInfo[depositIndex];
      allDeposits[i] = DepositDetails(d.pool, d.amount, d.unlockTime, pendingHsf(depositIndex));
    }
    return allDeposits;
  }

  // underscore placed after to avoid collide with the ERC721._baseURI property
  function setBaseURI(string memory baseURI_) external onlyOwner {
    _setBaseURI(baseURI_);
  }

  function disableContract(address _tokenRecipient) external onlyOwner notDisabled {
    massUpdatePools();
    uint256 remainingTokens = getDistribution(block.timestamp, endTime);
    _safeHsfTransfer(_tokenRecipient, remainingTokens.div(SCALE));
    contractDisabledAt = block.timestamp;
    emit Disabled();
  }

  function depositAdditionalRewards(uint256 _depositAmount) external {
    uint256 totalAllocationPoints_ = totalAllocationPoints;
    require(totalAllocationPoints_ > 0, "HF: no pools created");
    hsf.safeTransferFrom(msg.sender, address(this), _depositAmount);
    uint256 poolLen = pools.length();
    for (uint256 i; i < poolLen; i++) {
      IERC20 poolToken = IERC20(pools.at(i));
      PoolInfo storage pool = poolInfo[poolToken];
      uint256 poolTotalShares = pool.totalShares;
      if (poolTotalShares > 0) {
        uint256 poolScaledRewards = _depositAmount.mul(SCALE).mul(pool.allocation) /
          totalAllocationPoints_ /
          poolTotalShares;
        pool.accHsfPerShare = pool.accHsfPerShare.add(poolScaledRewards);
      }
    }
    emit RewardsAdded(_depositAmount);
  }

  // Add a new lp to the pool. Can only be called by the owner.
  function add(IERC20 _lpToken, uint256 _allocation) public onlyOwner notDisabled {
    require(_allocation > 0, "HF: Too low allocation");
    massUpdatePools();
    require(pools.add(address(_lpToken)), "HF: LP pool already exists");
    uint256 lastRewardTimestamp = Math.max(block.timestamp, startTime);
    totalAllocationPoints = totalAllocationPoints.add(_allocation);
    poolInfo[_lpToken] = PoolInfo({
      allocation: _allocation,
      lastRewardTimestamp: lastRewardTimestamp,
      accHsfPerShare: 0,
      totalShares: 0
    });
    emit PoolAdded(_lpToken, _allocation);
  }

  // Update the given pool's allocation point. Can only be called by the owner.
  function set(IERC20 _poolToken, uint256 _allocation) public onlyOwner notDisabled {
    require(pools.contains(address(_poolToken)), "HF: Non-existant pool");
    massUpdatePools();
    totalAllocationPoints = totalAllocationPoints.sub(poolInfo[_poolToken].allocation).add(
      _allocation
    );
    poolInfo[_poolToken].allocation = _allocation;
    emit PoolUpdated(_poolToken, _allocation);
    if (_allocation == 0) {
      pools.remove(address(_poolToken));
      emit PoolRemoved(_poolToken);
    }
  }

  // get tokens to be distributed between two timestamps scaled by SCALE
  function getDistribution(uint256 _from, uint256 _to) public view returns (uint256) {
    uint256 from = Math.max(startTime, _from);
    uint256 to = Math.min(_to, contractDisabledAt == 0 ? endTime : contractDisabledAt);

    if (from > to) return uint256(0);

    from = from.sub(startTime);
    to = to.sub(startTime);

    // check https://hackmd.io/BFrhyOTUQ3O9REs5PuZahQ for a breakdown of the maths
    // d(t1, t2) = (t2 - t1) * (2 * ds - (-m) * (t2 + t1)) / 2
    return to.sub(from).mul(startDistribution.mul(2).sub(distributionSlope.mul(from.add(to)))) / 2;
  }

  function getTimeMultiple(uint256 _unlockTime) public view returns (uint256) {
    if (_unlockTime == 0) return SCALE;
    uint256 timeDelta = _unlockTime.sub(block.timestamp);
    return timeDelta.mul(timeLockMultiplier).add(timeLockConstant);
  }

  // View function to see pending HSFs on frontend.
  function pendingHsf(uint256 _depositId) public view returns (uint256) {
    DepositInfo storage deposit = depositInfo[_depositId];
    PoolInfo storage pool = poolInfo[deposit.pool];
    return _getPendingHsf(deposit, pool);
  }

  // Deposit LP tokens into the farm to earn HSF
  function createDeposit(
    IERC20 _poolToken,
    uint256 _amount,
    uint256 _unlockTime
  ) external notDisabled {
    require(_amount > 0, "HF: Must deposit something");
    require(_unlockTime > block.timestamp, "HF: Invalid unlock time");
    require(pools.contains(address(_poolToken)), "HF: Non-existant pool");
    uint256 lockDuration = _unlockTime.sub(block.timestamp);
    require(minTimeLock <= lockDuration, "HF: Lock time too short");
    require(lockDuration <= maxTimeLock, "HF: Lock time exceeds maximum");

    PoolInfo storage pool = poolInfo[_poolToken];
    updatePool(_poolToken);
    _poolToken.safeTransferFrom(address(msg.sender), address(this), _amount);
    uint256 newDepositId = totalDeposits++;
    DepositInfo storage newDeposit = depositInfo[newDepositId];
    newDeposit.amount = _amount;
    newDeposit.pool = _poolToken;
    _resetRewardAccs(newDeposit, pool, _amount, _unlockTime);
    _safeMint(msg.sender, newDepositId);
  }

  // Withdraw LP tokens along with reward
  function closeDeposit(uint256 _depositId) external {
    require(ownerOf(_depositId) == msg.sender, "HF: Must be owner to withdraw");
    DepositInfo storage deposit = depositInfo[_depositId];
    require(
      deposit.unlockTime <= block.timestamp || contractDisabledAt > 0,
      "HF: Deposit still locked"
    );
    // require(
    //   deposit.unlockTime == 0 || deposit.unlockTime <= block.timestamp || contractDisabledAt > 0,
    //   "HF: Deposit still locked"
    // );
    IERC20 poolToken = deposit.pool;
    PoolInfo storage pool = poolInfo[poolToken];
    updatePool(poolToken);

    uint256 pending = _getPendingHsf(deposit, pool);
    pool.totalShares = pool.totalShares.sub(deposit.rewardShare);
    _burn(_depositId);
    _safeHsfTransfer(msg.sender, pending);
    poolToken.safeTransfer(msg.sender, deposit.amount);
    delete depositInfo[_depositId];
  }

  function withdrawRewards(uint256 _depositId) external {
    require(ownerOf(_depositId) == msg.sender, "HF: Must be owner of deposit");
    DepositInfo storage deposit = depositInfo[_depositId];
    PoolInfo storage pool = poolInfo[deposit.pool];
    uint256 _unlockTime = deposit.unlockTime;
    if (_unlockTime > 0 && _unlockTime <= block.timestamp) {
      _downgradeExpired(_depositId);
    } else {
      updatePool(deposit.pool);
    }
    uint256 pendingRewards = _getPendingHsf(deposit, pool);
    deposit.setRewards = uint256(0);
    deposit.rewardDebt = deposit.rewardShare.mul(pool.accHsfPerShare).div(SCALE);
    _safeHsfTransfer(msg.sender, pendingRewards);
    emit RewardsWithdraw(_depositId, pendingRewards);
  }

  // This exists so if an ERC20 is accidentally sent to this contract, the funds can be recovered
  function recoverToken(IERC20 _token) external onlyOwner {
    // So owner cannot steal desposited funds
    require(!pools.contains(address(_token)) && _token != hsf);
    _token.safeTransfer(msg.sender, _token.balanceOf(address(this)));
  }

  function downgradeExpired(uint256 _depositId) public {
    DepositInfo storage deposit = depositInfo[_depositId];
    require(deposit.unlockTime > 0, "HF: no lock to expire");
    require(deposit.unlockTime <= block.timestamp, "HF: deposit has not expired yet");
    _downgradeExpired(_depositId);
  }

  // Update reward variables for all pools. Be careful of gas spending!
  function massUpdatePools() public {
    uint256 length = pools.length();
    for (uint256 pid = 0; pid < length; pid++) {
      updatePool(IERC20(pools.at(pid)));
    }
  }

  // Update reward variables of the given pool to be up-to-date.
  function updatePool(IERC20 _poolToken) public {
    PoolInfo storage pool = poolInfo[_poolToken];
    if (block.timestamp <= pool.lastRewardTimestamp) {
      return;
    }
    uint256 totalShares = pool.totalShares;
    if (totalShares == 0) {
      pool.lastRewardTimestamp = block.timestamp;
      return;
    }
    uint256 dist = getDistribution(pool.lastRewardTimestamp, block.timestamp);
    uint256 hsfReward = dist.mul(pool.allocation).div(totalAllocationPoints);
    uint256 poolScaledRewards = hsfReward.div(totalShares);
    pool.accHsfPerShare = pool.accHsfPerShare.add(poolScaledRewards);
    pool.lastRewardTimestamp = block.timestamp;
  }

  function _downgradeExpired(uint256 _depositId) internal {
    DepositInfo storage deposit = depositInfo[_depositId];
    IERC20 poolToken = deposit.pool;
    PoolInfo storage pool = poolInfo[poolToken];
    updatePool(poolToken);
    deposit.setRewards = _getPendingHsf(deposit, pool);
    uint256 amount = deposit.amount;
    _resetRewardAccs(deposit, pool, amount, 0);
    // TODO: look into this (refer to audit)
    uint256 downgradeReward = amount.mul(downgradeFee).div(SCALE);
    poolToken.safeTransfer(msg.sender, downgradeReward);
    deposit.amount = amount.sub(downgradeReward);
    emit DepositDowngraded(msg.sender, _depositId, downgradeReward);
  }

  function _getPendingHsf(DepositInfo storage _deposit, PoolInfo storage _pool)
    internal
    view
    returns (uint256)
  {
    uint256 accHsfPerShare = _pool.accHsfPerShare;
    uint256 totalShares = _pool.totalShares;
    if (block.timestamp > _pool.lastRewardTimestamp && totalShares != 0) {
      uint256 dist = getDistribution(_pool.lastRewardTimestamp, block.timestamp);
      uint256 hsfReward = dist.mul(_pool.allocation).div(totalAllocationPoints);
      accHsfPerShare = accHsfPerShare.add(hsfReward.div(totalShares));
    }
    return
      _deposit.rewardShare.mul(accHsfPerShare).div(SCALE).sub(_deposit.rewardDebt).add(
        _deposit.setRewards
      );
  }

  function _resetRewardAccs(
    DepositInfo storage _deposit,
    PoolInfo storage _pool,
    uint256 _amount,
    uint256 _unlockTime
  ) internal {
    _deposit.unlockTime = _unlockTime;
    uint256 newShares = _amount.mul(getTimeMultiple(_unlockTime)).div(SCALE);
    _deposit.rewardDebt = newShares.mul(_pool.accHsfPerShare).div(SCALE);
    _pool.totalShares = _pool.totalShares.sub(_deposit.rewardShare).add(newShares);
    _deposit.rewardShare = newShares;
  }

  /* Safe hsf transfer function, just in case if rounding error causes pool
  to not have enough HSFs. */
  function _safeHsfTransfer(address _to, uint256 _amount) internal {
    uint256 hsfBal = hsf.balanceOf(address(this));
    hsf.safeTransfer(_to, Math.min(_amount, hsfBal));
  }
}

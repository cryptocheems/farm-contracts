// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "./IRewardManager.sol";
import "./IHoneyFarm.sol";

contract RewardManager is IRewardManager, Ownable {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  uint256 public constant SCALE = 1e18;
  IERC20 public immutable rewardToken;
  uint256 public immutable exchangeRate;

  constructor(IERC20 _rewardToken, uint256 _exchangeRate) Ownable() {
    require(_exchangeRate < SCALE, "RM: Invalid reward ratio");
    rewardToken = _rewardToken;
    exchangeRate = _exchangeRate;
  }

  function distributeReward(address _referrer, uint256 _amount) external override onlyOwner {
    uint256 currentReserves = rewardToken.balanceOf(address(this));
    uint256 reward = _amount.mul(exchangeRate).div(SCALE);
    if (reward <= currentReserves) {
      rewardToken.safeTransfer(_referrer, reward);
    } else if (currentReserves > 0) {
      rewardToken.safeTransfer(_referrer, currentReserves);
      emit MissingReward(_referrer, reward - currentReserves);
    } else {
      emit MissingReward(_referrer, reward);
    }
  }

  function grantFundsAccess() external override onlyOwner {
    address owner_ = owner();
    rewardToken.safeApprove(owner_, type(uint256).max);
    emit FundsAccessGranted(owner_);
  }

  function revokeFundsAccess() external {
    rewardToken.safeApprove(msg.sender, 0);
    emit FundsAccessRevoked(msg.sender);
  }

  function rebalance() external override {
    uint256 rmBalance = rewardToken.balanceOf(address(this));
    address farm = owner();
    uint256 farmBalance = rewardToken.balanceOf(farm);

    uint256 scaledRMBalance = SCALE.mul(rmBalance);
    uint256 ratioFarmBalance = exchangeRate.mul(farmBalance);
    if (scaledRMBalance > ratioFarmBalance) {
      uint256 targetRebalanceAmount = (scaledRMBalance - ratioFarmBalance) / (SCALE + exchangeRate);
      uint256 rebalanceAmount = Math.min(rmBalance, targetRebalanceAmount);
      IHoneyFarm(farm).depositAdditionalRewards(rebalanceAmount);
    }
  }
}

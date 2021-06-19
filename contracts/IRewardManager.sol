// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;

interface IRewardManager {
  function distributeReward(address _referrer, uint256 _amount) external;

  function grantFundsAccess() external;

  function rebalance() external;

  event MissingReward(address indexed referrer, uint256 owedReward);
  event FundsAccessGranted(address indexed spender);
  event FundsAccessRevoked(address indexed spender);
}

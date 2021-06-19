// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IHoneyFarm {
  function depositAdditionalRewards(uint256 _depositAmount) external;

  function disableContract(address _tokenRecipient) external;

  function setBaseURI(string memory baseURI_) external;

  function add(IERC20 _lpToken, uint256 _allocation) external;

  function set(IERC20 _poolToken, uint256 _allocation) external;
}

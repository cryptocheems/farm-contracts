// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20("Test token", "TST") {
  function mint(address recipient, uint256 amount) external {
    _mint(recipient, amount);
  }
}

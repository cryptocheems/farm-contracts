// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract CombToken is ERC20 {
  constructor(string memory _name, string memory _symbol) ERC20(_name, _symbol) {
    // 1 million initial supply
    _mint(msg.sender, 10**6 * 1e18);
  }
}

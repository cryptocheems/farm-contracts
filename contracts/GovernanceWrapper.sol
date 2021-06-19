// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "./IHoneyFarm.sol";
import "./IRewardManager.sol";

contract GovernanceWrapper is AccessControl {
  using SafeERC20 for IERC20;

  IHoneyFarm public immutable farm;
  IRewardManager public immutable rewardManager;
  IERC20 public farmToken;

  // keccak256("honeyswap-farm.governance-wrapper.role.admin")
  bytes32 public constant ADMIN_ROLE =
    0xd97c39a48e3b15b7eb98f798ff6b134f3e5d12f72b349c02943c4a4b4e3119fa;
  // keccak256("honeyswap-farm.governance-wrapper.role.manager")
  bytes32 public constant MANAGER_ROLE =
    0xbdbfb41069c8d9d96d4cabde4c51a68c8ef03deaecb4dd906af7125adeeed66f;

  constructor(
    IHoneyFarm _farm,
    IRewardManager _rewardManager,
    IERC20 _farmToken
  ) {
    _setupRole(ADMIN_ROLE, msg.sender);
    _setRoleAdmin(ADMIN_ROLE, ADMIN_ROLE);
    _setRoleAdmin(MANAGER_ROLE, ADMIN_ROLE);
    farm = _farm;
    rewardManager = _rewardManager;
    farmToken = _farmToken;
  }

  modifier onlyAdmin {
    require(hasRole(ADMIN_ROLE, msg.sender), "GovWrapper: not admin");
    _;
  }

  modifier onlyManager {
    require(hasRole(MANAGER_ROLE, msg.sender), "GovWrapper: not manager");
    _;
  }

  function setup() external onlyAdmin {
    rewardManager.grantFundsAccess();
    Ownable(address(rewardManager)).transferOwnership(address(farm));
    farm.setRewardManager(address(rewardManager));
  }

  function shutdownFarming(address _leftoverRecipient) external onlyAdmin {
    farm.disableContract(_leftoverRecipient);
    uint256 rewardManagerBalance = farmToken.balanceOf(address(rewardManager));
    farmToken.safeTransferFrom(address(rewardManager), _leftoverRecipient, rewardManagerBalance);
  }

  function moveFarmOwnershipTo(address _newOwner) external onlyAdmin {
    Ownable(address(farm)).transferOwnership(_newOwner);
  }

  function modifyPools(
    IERC20[] calldata _lpTokens,
    uint256[] calldata _allocations,
    bool[] calldata _isAdding
  ) external onlyManager {
    uint256 lpTokensLength = _lpTokens.length;
    require(
      lpTokensLength == _allocations.length && lpTokensLength == _isAdding.length,
      "GovWrapper: input len mismatch"
    );
    for (uint256 i; i < lpTokensLength; i++) {
      if (_isAdding[i]) farm.add(_lpTokens[i], _allocations[i]);
      else farm.set(_lpTokens[i], _allocations[i]);
    }
  }

  function setBaseURI(string memory _baseURI) external onlyManager {
    farm.setBaseURI(_baseURI);
  }
}

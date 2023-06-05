// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./interfaces/IElixirFactoryOwner.sol";
import "../elixir-core/interfaces/pool/IElixirPoolOwnerActions.sol";
import "../elixir-core/interfaces/IElixirFactory.sol";

/** @notice Owner contract for managing access control to factory owner gated calls. */
contract ElixirFactoryOwner is IElixirFactoryOwner, AccessControlEnumerable {
    using SafeERC20 for IERC20;
    using Address for address payable;

    bytes32 public constant REWARDER = keccak256("REWARDER");
    bytes32 public constant FEE_SETTER_ROLE = keccak256("FEE_SETTER_ROLE");
    bytes32 public constant FEE_COLLECTOR_ROLE = keccak256("FEE_COLLECTOR_ROLE");
    bytes32 public constant REWARD_ADDING_ROLE = keccak256("REWARD_ADDING_ROLE");
    bytes32 public constant REWARD_MANAGER_ROLE = keccak256("REWARD_MANAGER_ROLE");
    address public immutable factory;

    constructor(address owner, address factory_) {
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        factory = factory_;
    }

    function setRewardRate(
        address pool,
        uint144 rewardPerSecondX48,
        uint32 rewardRateEffectiveUntil
    ) external onlyRole(REWARDER) {
        IElixirPoolOwnerActions(pool).setRewardRate({
            rewardPerSecondX48: rewardPerSecondX48,
            rewardRateEffectiveUntil: rewardRateEffectiveUntil
        });
    }

    function setFeeProtocol(
        address pool,
        uint8 feeProtocol0,
        uint8 feeProtocol1
    ) external onlyRole(FEE_SETTER_ROLE) {
        IElixirPoolOwnerActions(pool).setFeeProtocol({
            feeProtocol0: feeProtocol0,
            feeProtocol1: feeProtocol1
        });
    }

    struct CollectProtocol {
        address pool;
        address recipient;
        uint128 amount0Requested;
        uint128 amount1Requested;
    }
    function collectProtocolFees(
        CollectProtocol[] calldata collectProtocols
    ) external onlyRole(FEE_COLLECTOR_ROLE) {
        uint256 length = collectProtocols.length;
        CollectProtocol calldata collectProtocol;

        for (uint256 i = 0; i < length; ) {
            collectProtocol = collectProtocols[i];

            IElixirPoolOwnerActions(collectProtocol.pool).collectProtocol({
                recipient: collectProtocol.recipient,
                amount0Requested: collectProtocol.amount0Requested,
                amount1Requested: collectProtocol.amount1Requested
            });

            unchecked {
                ++i;
            }
        }
    }

    function enableFeeAmount(uint24 fee, int24 tickSpacing) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IElixirFactory(factory).enableFeeAmount({fee: fee, tickSpacing: tickSpacing});
    }

    function approveERC20(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IERC20(token).safeApprove(to, amount);
    }

    function withdrawToken(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0)) {
            payable(to).sendValue(amount);
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    function doAnything(
        address target,
        bytes memory leData
    ) external payable onlyRole(DEFAULT_ADMIN_ROLE) {
        assembly {
            let result := call(gas(), target, callvalue(), add(leData, 0x20), mload(leData), 0, 0)

            // Copy the returned data.
            returndatacopy(0, 0, returndatasize())

            switch result
            // call returns 0 on error.
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }
}

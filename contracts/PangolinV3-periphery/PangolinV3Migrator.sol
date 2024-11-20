// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import '../PangolinV3-core/libraries/LowGasSafeMath.sol';
import '../pangolin-core/interfaces/IPangolinPair.sol';

import './interfaces/INonfungiblePositionManager.sol';

import './libraries/TransferHelper.sol';

import './interfaces/IPangolinV3Migrator.sol';
import './base/PeripheryImmutableState.sol';
import './base/Multicall.sol';
import './base/SelfPermit.sol';
import './interfaces/external/IWETH9.sol';
import './base/PoolInitializer.sol';

/// @title PangolinV3 Migrator
contract PangolinV3Migrator is IPangolinV3Migrator, PeripheryImmutableState, PoolInitializer, Multicall, SelfPermit {
    using LowGasSafeMath for uint256;

    address public immutable nonfungiblePositionManager;

    constructor(
        address _factory,
        address _WETH9,
        address _nonfungiblePositionManager
    ) PeripheryImmutableState(_factory, _WETH9) {
        nonfungiblePositionManager = _nonfungiblePositionManager;
    }

    receive() external payable {
        require(msg.sender == WETH9, 'Not WETH9');
    }

    function migrate(MigrateParams calldata params) external override {
        require(params.percentageToMigrate > 0, 'Percentage too small');
        require(params.percentageToMigrate <= 100, 'Percentage too large');

        // burn v1 liquidity to this address
        IPangolinPair(params.pair).transferFrom(msg.sender, params.pair, params.liquidityToMigrate);
        (uint256 amount0V1, uint256 amount1V1) = IPangolinPair(params.pair).burn(address(this));

        // calculate the amounts to migrate to pangolinv3
        uint256 amount0V1ToMigrate = amount0V1.mul(params.percentageToMigrate) / 100;
        uint256 amount1V1ToMigrate = amount1V1.mul(params.percentageToMigrate) / 100;

        // approve the position manager up to the maximum token amounts
        TransferHelper.safeApprove(params.token0, nonfungiblePositionManager, amount0V1ToMigrate);
        TransferHelper.safeApprove(params.token1, nonfungiblePositionManager, amount1V1ToMigrate);

        // mint pangolinv3 position
        (, , uint256 amount0V2, uint256 amount1V2) =
            INonfungiblePositionManager(nonfungiblePositionManager).mint(
                INonfungiblePositionManager.MintParams({
                    token0: params.token0,
                    token1: params.token1,
                    fee: params.fee,
                    tickLower: params.tickLower,
                    tickUpper: params.tickUpper,
                    amount0Desired: amount0V1ToMigrate,
                    amount1Desired: amount1V1ToMigrate,
                    amount0Min: params.amount0Min,
                    amount1Min: params.amount1Min,
                    recipient: params.recipient,
                    deadline: params.deadline
                })
            );

        // if necessary, clear allowance and refund dust
        if (amount0V2 < amount0V1) {
            if (amount0V2 < amount0V1ToMigrate) {
                TransferHelper.safeApprove(params.token0, nonfungiblePositionManager, 0);
            }

            uint256 refund0 = amount0V1 - amount0V2;
            if (params.refundAsETH && params.token0 == WETH9) {
                IWETH9(WETH9).withdraw(refund0);
                TransferHelper.safeTransferETH(msg.sender, refund0);
            } else {
                TransferHelper.safeTransfer(params.token0, msg.sender, refund0);
            }
        }
        if (amount1V2 < amount1V1) {
            if (amount1V2 < amount1V1ToMigrate) {
                TransferHelper.safeApprove(params.token1, nonfungiblePositionManager, 0);
            }

            uint256 refund1 = amount1V1 - amount1V2;
            if (params.refundAsETH && params.token1 == WETH9) {
                IWETH9(WETH9).withdraw(refund1);
                TransferHelper.safeTransferETH(msg.sender, refund1);
            } else {
                TransferHelper.safeTransfer(params.token1, msg.sender, refund1);
            }
        }
    }
}

// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

import "../pangolin-core/interfaces/IPangolinPair.sol";
import "../pangolin-core/interfaces/IPangolinFactory.sol";
import "../pangolin-periphery/interfaces/IERC20.sol";
import "../pangolin-periphery/interfaces/IPangolinRouter.sol";
import "../pangolin-periphery/libraries/PangolinLibrary.sol";
import "./libraries/SafeERC20.sol";
import "./libraries/Ownable.sol";

// PangolinRoll helps your migrate your existing Sushiswap LP tokens to Pangolin LP ones
contract PangolinRoll is Ownable {
    using SafeERC20 for IERC20;

    IPangolinRouter public oldRouter;
    IPangolinRouter public router;
    IERC20 public pngToken = IERC20(0x60781C2586D68229fde47564546784ab3fACA982); // png token address

    constructor(IPangolinRouter _oldRouter, IPangolinRouter _router) public {
        oldRouter = _oldRouter;
        router = _router;
    }

    function migrateWithPermit(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public {
        IPangolinPair pair = IPangolinPair(pairForOldRouter(tokenA, tokenB));
        pair.permit(msg.sender, address(this), liquidity, deadline, v, r, s);

        migrate(tokenA, tokenB, liquidity, amountAMin, amountBMin, deadline);
    }

    // msg.sender should have approved 'liquidity' amount of LP token of 'tokenA' and 'tokenB'
    function migrate(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 deadline
    ) public {
        require(deadline >= block.timestamp, "PangolinSwap: EXPIRED");

        // Remove liquidity from the old router with permit
        (uint256 amountA, uint256 amountB) = removeLiquidity(
            tokenA,
            tokenB,
            liquidity,
            amountAMin,
            amountBMin
        );

        // Add liquidity to the new router
        (uint256 pooledAmountA, uint256 pooledAmountB) = addLiquidity(
            tokenA,
            tokenB,
            amountA,
            amountB
        );

        // Send remaining tokens to msg.sender
        if (amountA > pooledAmountA) {
            IERC20(tokenA).safeTransfer(msg.sender, amountA - pooledAmountA);
        }
        if (amountB > pooledAmountB) {
            IERC20(tokenB).safeTransfer(msg.sender, amountB - pooledAmountB);
        }

        // Transfer user a single PNG token if there are any remaining and user has not received one yet
        if (address(pngToken) != address(0)) {
            uint256 pngSupply = pngToken.balanceOf(address(this));
            uint256 userSupply = pngToken.balanceOf(msg.sender);
            if (pngSupply > 0 && userSupply == 0) {
                pngToken.safeTransfer(msg.sender, 1e18);
            }
        }
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin
    ) internal returns (uint256 amountA, uint256 amountB) {
        IPangolinPair pair = IPangolinPair(pairForOldRouter(tokenA, tokenB));
        pair.transferFrom(msg.sender, address(pair), liquidity);
        (uint256 amount0, uint256 amount1) = pair.burn(address(this));
        (address token0, ) = PangolinLibrary.sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0
            ? (amount0, amount1)
            : (amount1, amount0);
        require(amountA >= amountAMin, "PangolinRoll: INSUFFICIENT_A_AMOUNT");
        require(amountB >= amountBMin, "PangolinRoll: INSUFFICIENT_B_AMOUNT");
    }

    // calculates the CREATE2 address for a pair without making any external calls
    function pairForOldRouter(address tokenA, address tokenB)
        internal
        view
        returns (address pair)
    {
        return IPangolinFactory(oldRouter.factory()).getPair(tokenA, tokenB);
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired
    ) internal returns (uint256 amountA, uint256 amountB) {
        (amountA, amountB) = _addLiquidity(
            tokenA,
            tokenB,
            amountADesired,
            amountBDesired
        );
        address pair = PangolinLibrary.pairFor(
            router.factory(),
            tokenA,
            tokenB
        );
        IERC20(tokenA).safeTransfer(pair, amountA);
        IERC20(tokenB).safeTransfer(pair, amountB);
        IPangolinPair(pair).mint(msg.sender);
    }

    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired
    ) internal returns (uint256 amountA, uint256 amountB) {
        // create the pair if it doesn't exist yet
        IPangolinFactory factory = IPangolinFactory(router.factory());
        if (factory.getPair(tokenA, tokenB) == address(0)) {
            factory.createPair(tokenA, tokenB);
        }
        (uint256 reserveA, uint256 reserveB) = PangolinLibrary.getReserves(
            address(factory),
            tokenA,
            tokenB
        );
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint256 amountBOptimal = PangolinLibrary.quote(
                amountADesired,
                reserveA,
                reserveB
            );
            if (amountBOptimal <= amountBDesired) {
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint256 amountAOptimal = PangolinLibrary.quote(
                    amountBDesired,
                    reserveB,
                    reserveA
                );
                assert(amountAOptimal <= amountADesired);
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }
}

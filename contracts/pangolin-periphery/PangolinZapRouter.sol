pragma solidity ^0.7.0;

import "../pangolin-core/interfaces/IPangolinFactory.sol";
import '../pangolin-lib/libraries/TransferHelper.sol';
import './interfaces/IPangolinRouter.sol';
import "./libraries/PangolinLibrary.sol";

contract PangolinZapRouter {
    using SafeMath for uint;

    IPangolinFactory public immutable factory;
    IPangolinRouter public immutable swapRouter;
    address public immutable WAVAX = 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7;

    constructor(
        address _factory,
        address _router,
    ) {
        factory = IPangolinFactory(_factory);
        swapRouter = IPangolinRouter(_router);
    }

    // safety measure to prevent clear front-running by delayed block
    modifier ensure(uint deadline) {
        require(deadline >= block.timestamp, 'PangolinZapRouter: EXPIRED');
        _;
    }

    function _simpleSwap(
        uint amount,
        address fromToken,
        address swapPair,
        uint deadline,
    ) internal returns (uint) {
        address[] path = new address[2];
        path[0] = IPangolinPair(swapPair).token0();
        path[1] = IPangolinPair(swapPair).token1();
        if (IPangolinPair(swapPair).token0() != fromToken) {
            (path[0], path[1]) = (path[1], path[0]);
        }
        uint amountOut = PangolinLibrary.getAmountsOut(
            address(factory),
            amount,
            path
        );
        swapRouter.swapExactTokensForTokens(amount, amountOut, path, address(this), deadline);
        return amountOut
    }


    function convertLiquidity(
        address liquidityPairFrom,
        address liquidityPairTo,
        address to,
        uint amount,
        uint deadline
    ) external ensure(deadline) {
        require(liquidityPairFrom != address(0), "PangolinZapRouter::liquidityPairFrom address 0");
        require(liquidityPairTo != address(0), "PangolinZapRouter::liquidityPairTo address 0");
        require(liquidityPairTo != liquidityPairFrom, "PangolinZapRouter::cant convert to the same liquidity pairs");
        address fromTokenA = IPangolinPair(liquidityPairFrom).token0();
        address fromTokenB = IPangolinPair(liquidityPairFrom).token1();
        address toTokenA = IPangolinPair(liquidityPairTo).token0();
        address toTokenB = IPangolinPair(liquidityPairTo).token1();
        TransferHelper.safeTransferFrom(liquidityPairFrom, msg.sender, address(this), amount);
        (uint amountTokenA, uint amountTokenB) = IPangolinPair(liquidityPairFrom).burn(address(this));
        uint amountOutTokenA;
        uint amountOutTokenB;
        if (fromTokenA != toTokenA && fromTokenA != toTokenB) {
            // there's no token matching
            if (fromTokenB != toTokenA && fromTokenB != toTokenB) {
                address swapPairA = factory.getPair(fromTokenA, toTokenA);
                address swapPairB = factory.getPair(fromTokenB, toTokenB);
                if (swapPairA == address(0)) {
                    swapPairA = factory.getPair(fromTokenA, toTokenB);
                    swapPairB = factory.getPair(fromTokenB, toTokenA);
                    require(swapPairA != address(0), "PangolinZapRouter::Can't find the first swap pair to perform the conversion");
                    require(swapPairB != address(0), "PangolinZapRouter::Can't find the second swap pair to perform the conversion");
                    amountOutTokenB = _simpleSwap(amountTokenA, fromTokenA, swapPairA, deadline);
                    amountOutTokenA = _simpleSwap(amountTokenB, fromTokenB, swapPairB, deadline);
                } else {
                    amountOutTokenA = _simpleSwap(amountTokenA, fromTokenA, swapPairA, deadline);
                    amountOutTokenB = _simpleSwap(amountTokenB, fromTokenB, swapPairB, deadline);
                }
            }
            else {
                if (fromTokenB == toTokenA) {
                    address swapPair = factory.getPair(fromTokenA, toTokenB);
                    require(swapPair != address(0), "PangolinZapRouter::Can't find the fromTokenA toTokenB swap pair to perform the conversion");
                    amountOutTokenB = _simpleSwap(amountTokenA, fromTokenA, swapPair, deadline);
                    amountOutTokenA = amountTokenB;
                } else {
                    address swapPair = factory.getPair(fromTokenA, toTokenA);
                    require(swapPair != address(0), "PangolinZapRouter::Can't find the fromTokenA toTokenA swap pair to perform the conversion");
                    amountOutTokenA = _simpleSwap(amountTokenA, fromTokenA, swapPair, deadline);
                    amountOutTokenB = amountTokenB;
                }
            }
        } else {
            if (fromTokenA == toTokenA) {
                address swapPair = factory.getPair(fromTokenB, toTokenB);
                require(swapPair != address(0), "PangolinZapRouter::Can't find the fromTokenA toTokenA swap pair to perform the conversion");
                amountOutTokenA = amountTokenA;
                amountOutTokenB = _simpleSwap(amountTokenB, fromTokenB, swapPair, deadline);
            } else {
                address swapPair = factory.getPair(fromTokenB, toTokenA);
                require(swapPair != address(0), "PangolinZapRouter::Can't find the fromTokenA toTokenB swap pair to perform the conversion");
                amountOutTokenB = _simpleSwap(amountTokenB, fromTokenB, swapPair, deadline);
                amountOutTokenA = amountTokenB;
            }
        }
    }
}
pragma solidity ^0.6.6;

import "../pangolin-core/interfaces/IPangolinFactory.sol";
import '../pangolin-lib/libraries/TransferHelper.sol';
import './interfaces/IPangolinRouter.sol';
import "./libraries/PangolinLibrary.sol";
import "../pangolin-core/interfaces/IPangolinERC20.sol";
import "hardhat/console.sol";

contract PangolinZapRouter {
    using SafeMath for uint;

    IPangolinFactory public immutable factory;
    IPangolinRouter public immutable swapRouter;
    address public immutable WAVAX = 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7;

    constructor(
        address _factory,
        address _router
    ) public {
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
        uint deadline
    ) internal returns (uint) {
        address[] memory path = new address[](2);
        path[0] = IPangolinPair(swapPair).token0();
        path[1] = IPangolinPair(swapPair).token1();
        if (IPangolinPair(swapPair).token0() != fromToken) {
            (path[0], path[1]) = (path[1], path[0]);
        }
        uint amountOut = PangolinLibrary.getAmountsOut(
            address(factory),
            amount,
            path
        )[1];
        _allowToken(fromToken, address(swapRouter), amount);
        swapRouter.swapExactTokensForTokens(amount, amountOut, path, address(this), deadline);
        return amountOut;
    }

    function _allowToken(address tokenAddress, address spenderAddress, uint amount) internal {
        if (IPangolinERC20(tokenAddress).allowance(address(this), spenderAddress) <= amount) {
            IPangolinERC20(tokenAddress).approve(spenderAddress, uint(-1));
        }
    }

    function _convert(address fromTokenA, address fromTokenB, address toTokenA, address toTokenB, uint amountTokenA, uint amountTokenB) internal returns (uint amountOutTokenA, uint amountOutTokenB) {
        uint deadline = block.timestamp;
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

    function _addLiquidity(address pairToken, address token0, address token1, uint amountIn0, uint amountIn1, address to) private returns (uint amount0, uint amount1, uint liquidityAmount) {
        (uint112 reserve0, uint112 reserve1,) = IPangolinPair(pairToken).getReserves();
        uint quote0 = amountIn0;
        uint quote1 = PangolinLibrary.quote(amountIn0, reserve0, reserve1);
        if (quote1 > amountIn1) {
            quote1 = amountIn1;
            quote0 = PangolinLibrary.quote(amountIn1, reserve1, reserve0);
        }
        
        TransferHelper.safeTransfer(token0, pairToken, quote0);
        TransferHelper.safeTransfer(token1, pairToken, quote1);
        amount0 = amountIn0 - quote0;
        amount1 = amountIn1 - quote1;
        liquidityAmount = IPangolinPair(pairToken).mint(to);
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
        TransferHelper.safeTransferFrom(liquidityPairFrom, msg.sender, address(this), amount);
        _allowToken(liquidityPairFrom, address(swapRouter), amount);
        TransferHelper.safeTransfer(liquidityPairFrom, liquidityPairFrom, amount);
        (uint amountTokenA, uint amountTokenB) = IPangolinPair(liquidityPairFrom).burn(address(this));
        (uint amountOutTokenA, uint amountOutTokenB) = _convert(
            IPangolinPair(liquidityPairFrom).token0(), IPangolinPair(liquidityPairFrom).token1(),
            IPangolinPair(liquidityPairTo).token0(), IPangolinPair(liquidityPairTo).token1(),
            amountTokenA, amountTokenB
        );
        _allowToken(IPangolinPair(liquidityPairTo).token0(), address(swapRouter), amountOutTokenA);
        _allowToken(IPangolinPair(liquidityPairTo).token1(), address(swapRouter), amountOutTokenB);
        console.log(IPangolinERC20(IPangolinPair(liquidityPairTo).token0()).balanceOf(address(this)));
        console.log(IPangolinERC20(IPangolinPair(liquidityPairTo).token1()).balanceOf(address(this)));
        (uint changeAmount0, uint changeAmount1, ) = _addLiquidity(
            liquidityPairTo,
            IPangolinPair(liquidityPairTo).token0(), IPangolinPair(liquidityPairTo).token1(),
            amountOutTokenA, amountOutTokenB, msg.sender
        );
        console.log(changeAmount0);
        console.log(changeAmount1);
        if (changeAmount0 > 0) {
            TransferHelper.safeTransfer(IPangolinPair(liquidityPairTo).token0(), msg.sender, changeAmount0);
        }
        if (changeAmount1 > 0) {
            TransferHelper.safeTransfer(IPangolinPair(liquidityPairTo).token1(), msg.sender, changeAmount1);
        }
    }
}
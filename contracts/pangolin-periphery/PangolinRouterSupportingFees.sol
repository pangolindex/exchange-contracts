pragma solidity 0.6.6;

import "openzeppelin-contracts-legacy/access/Ownable.sol";
import "../pangolin-lib/libraries/TransferHelper.sol";
import "./libraries/PangolinLibrary.sol";
import "./libraries/SafeMath.sol";

import "./interfaces/IERC20.sol";
import "./interfaces/IWAVAX.sol";

contract PangolinRouterSupportingFees is Ownable {
    using SafeMath for uint256;

    address public immutable FACTORY;
    address public immutable WAVAX;

    uint24 constant private BIPS = 100_00;
    uint24 constant public MAX_FEE = 2_00;
    uint24 constant private MAX_FEE_CUT = 50_00;

    struct FeeInfo {
        uint24 feePartner;      // Range [ 0, 200 ]
        uint24 feeProtocol;     // Range [ 0, 200 ]
        uint24 feeTotal;        // Range [ 0, 200 ]
        uint24 feeCut;          // Range [ 0, 5000 ]
        bool initialized;
    }

    mapping(address => FeeInfo) public feeInfos;

    // partner => manager => isAllowed
    mapping(address => mapping(address => bool)) public managers;

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "EXPIRED");
        _;
    }

    event ProtocolFee(address indexed partner, address indexed token, uint256 amount);
    event PartnerFee(address indexed partner, address indexed token, uint256 amount);
    event FeeWithdrawn(address indexed token, uint256 amount, address to);
    event FeeChange(address indexed partner, uint24 feePartner, uint24 feeProtocol, uint24 feeTotal, uint24 feeCut);
    event AlterManager(address indexed partner, address manager, bool isAllowed);

    constructor(address _factory, address _WAVAX, address firstOwner) public {
        FACTORY = _factory; // 0xefa94DE7a4656D787667C749f7E1223D71E9FD88
        WAVAX = _WAVAX; // 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7
        transferOwnership(firstOwner);
    }

    receive() external payable {
        assert(msg.sender == WAVAX); // only accept AVAX via fallback from the WAVAX contract
    }

    // **** SWAP ****
    // requires the initial amount to have already been sent to the first pair
    // returns resulting balance to address(this)
    function _swap(uint256[] memory amounts, address[] memory path) internal {
        for (uint256 i; i < path.length - 1; ++i) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = PangolinLibrary.sortTokens(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) = input == token0 ? (uint(0), amountOut) : (amountOut, uint(0));
            address to = i < path.length - 2 ? PangolinLibrary.pairFor(FACTORY, output, path[i + 2]) : address(this);
            IPangolinPair(PangolinLibrary.pairFor(FACTORY, input, output)).swap(
                amount0Out, amount1Out, to, new bytes(0)
            );
        }
    }
    function _distribute(
        uint256 userAmountOut,
        address tokenOut,
        address userTo,
        address partnerFeeTo,
        uint256 feeCut,
        uint256 feeTotalAmount
    ) internal {
        uint256 pangolinFeeAmount = feeTotalAmount.mul(feeCut) / BIPS;
        uint256 partnerFeeAmount = feeTotalAmount - pangolinFeeAmount;

        if (pangolinFeeAmount > 0) {
            emit ProtocolFee(partnerFeeTo, tokenOut, pangolinFeeAmount);
        }
        if (partnerFeeAmount > 0) {
            TransferHelper.safeTransfer(tokenOut, partnerFeeTo, partnerFeeAmount);
            emit PartnerFee(partnerFeeTo, tokenOut, partnerFeeAmount);
        }
        TransferHelper.safeTransfer(tokenOut, userTo, userAmountOut);
    }
    function _distributeAVAX(
        uint256 userAmountOut,
        address userTo,
        address partnerFeeTo,
        uint256 feeCut,
        uint256 feeTotalAmount
    ) internal {
        uint256 pangolinFeeAmount = feeTotalAmount.mul(feeCut) / BIPS;
        uint256 partnerFeeAmount = feeTotalAmount - pangolinFeeAmount;

        if (pangolinFeeAmount > 0) {
            emit ProtocolFee(partnerFeeTo, WAVAX, pangolinFeeAmount);
        }
        if (partnerFeeAmount > 0) {
            TransferHelper.safeTransfer(WAVAX, partnerFeeTo, partnerFeeAmount);
            emit PartnerFee(partnerFeeTo, WAVAX, partnerFeeAmount);
        }
        IWAVAX(WAVAX).withdraw(userAmountOut);
        TransferHelper.safeTransferAVAX(userTo, userAmountOut);
    }
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline,
        address feeTo
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        FeeInfo storage feeInfo = feeInfos[feeTo];

        amounts = PangolinLibrary.getAmountsOut(FACTORY, amountIn, path);

        uint256 feeTotalAmount;
        uint256 userAmountOut;

        { // Scope amountOut locally
            uint256 amountOut = amounts[amounts.length - 1];
            feeTotalAmount = amountOut.mul(feeInfo.feeTotal) / BIPS;
            userAmountOut = amountOut - feeTotalAmount;
        }

        require(userAmountOut >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");

        TransferHelper.safeTransferFrom(
            path[0], msg.sender, PangolinLibrary.pairFor(FACTORY, path[0], path[1]), amountIn
        );

        _swap(amounts, path);
        _distribute(userAmountOut, path[path.length - 1], to, feeTo, feeInfo.feeCut, feeTotalAmount);
    }
    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline,
        address feeTo
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        FeeInfo storage feeInfo = feeInfos[feeTo];

        uint256 feeTotalAmount = amountOut.mul(feeInfo.feeTotal) / BIPS;

        // Adjust amountOut to include fee
        amounts = PangolinLibrary.getAmountsIn(FACTORY, amountOut.add(feeTotalAmount), path);
        uint256 amountIn = amounts[0];
        require(amountIn <= amountInMax, "EXCESSIVE_INPUT_AMOUNT");

        TransferHelper.safeTransferFrom(
            path[0], msg.sender, PangolinLibrary.pairFor(FACTORY, path[0], path[1]), amountIn
        );

        _swap(amounts, path);
        _distribute(amountOut, path[path.length - 1], to, feeTo, feeInfo.feeCut, feeTotalAmount);
    }
    function swapExactAVAXForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline,
        address feeTo
    ) external payable ensure(deadline) returns (uint256[] memory amounts) {
        require(path[0] == WAVAX, "INVALID_PATH");

        FeeInfo storage feeInfo = feeInfos[feeTo];

        amounts = PangolinLibrary.getAmountsOut(FACTORY, msg.value, path);

        uint256 amountOut = amounts[amounts.length - 1];
        uint256 feeTotalAmount = amountOut.mul(feeInfo.feeTotal) / BIPS;
        uint256 userAmountOut = amountOut - feeTotalAmount;

        require(userAmountOut >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");

        IWAVAX(WAVAX).deposit{value: msg.value}();
        assert(IWAVAX(WAVAX).transfer(PangolinLibrary.pairFor(FACTORY, WAVAX, path[1]), msg.value));

        _swap(amounts, path);
        _distribute(userAmountOut, path[path.length - 1], to, feeTo, feeInfo.feeCut, feeTotalAmount);
    }
    function swapTokensForExactAVAX(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline,
        address feeTo
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        require(path[path.length - 1] == WAVAX, "INVALID_PATH");

        FeeInfo storage feeInfo = feeInfos[feeTo];

        uint256 feeTotalAmount = amountOut.mul(feeInfo.feeTotal) / BIPS;

        // Adjust amountOut to include fee
        amounts = PangolinLibrary.getAmountsIn(FACTORY, amountOut.add(feeTotalAmount), path);
        uint256 amountIn = amounts[0];
        require(amountIn <= amountInMax, "EXCESSIVE_INPUT_AMOUNT");

        TransferHelper.safeTransferFrom(
            path[0], msg.sender, PangolinLibrary.pairFor(FACTORY, path[0], path[1]), amountIn
        );

        _swap(amounts, path);
        _distributeAVAX(amountOut, to, feeTo, feeInfo.feeCut, feeTotalAmount);
    }
    function swapExactTokensForAVAX(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline,
        address feeTo
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        require(path[path.length - 1] == WAVAX, "INVALID_PATH");

        FeeInfo storage feeInfo = feeInfos[feeTo];

        amounts = PangolinLibrary.getAmountsOut(FACTORY, amountIn, path);

        uint256 feeTotalAmount;
        uint256 userAmountOut;

        { // Scope amountOut locally
            uint256 amountOut = amounts[amounts.length - 1];
            feeTotalAmount = amountOut.mul(feeInfo.feeTotal) / BIPS;
            userAmountOut = amountOut - feeTotalAmount;
        }

        require(userAmountOut >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");

        TransferHelper.safeTransferFrom(
            path[0], msg.sender, PangolinLibrary.pairFor(FACTORY, path[0], path[1]), amounts[0]
        );

        _swap(amounts, path);
        _distributeAVAX(userAmountOut, to, feeTo, feeInfo.feeCut, feeTotalAmount);
    }
    function swapAVAXForExactTokens(
        uint256 amountOut,
        address[] calldata path,
        address to,
        uint256 deadline,
        address feeTo
    ) external payable ensure(deadline) returns (uint256[] memory amounts) {
        require(path[0] == WAVAX, "INVALID_PATH");

        FeeInfo storage feeInfo = feeInfos[feeTo];

        uint256 feeTotalAmount = amountOut.mul(feeInfo.feeTotal) / BIPS;

        // Adjust amountOut to include fee
        amounts = PangolinLibrary.getAmountsIn(FACTORY, amountOut.add(feeTotalAmount), path);
        uint256 amountIn = amounts[0];
        require(amountIn <= msg.value, "EXCESSIVE_INPUT_AMOUNT");

        IWAVAX(WAVAX).deposit{value: amountIn}();
        assert(IWAVAX(WAVAX).transfer(PangolinLibrary.pairFor(FACTORY, WAVAX, path[1]), amountIn));

        _swap(amounts, path);
        _distribute(amountOut, path[path.length - 1], to, feeTo, feeInfo.feeCut, feeTotalAmount);

        // refund dust AVAX, if any
        if (msg.value > amountIn) TransferHelper.safeTransferAVAX(msg.sender, msg.value - amountIn);
    }

    // **** SWAP (supporting fee-on-transfer tokens) ****
    // requires the initial amount to have already been sent to the first pair
    // returns resulting balance to address(this)
    function _swapSupportingFeeOnTransferTokens(address[] memory path) internal {
        for (uint256 i; i < path.length - 1; ++i) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = PangolinLibrary.sortTokens(input, output);
            IPangolinPair pair = IPangolinPair(PangolinLibrary.pairFor(FACTORY, input, output));
            uint256 amountInput;
            uint256 amountOutput;
            { // scope to avoid stack too deep errors
            (uint256 reserve0, uint256 reserve1,) = pair.getReserves();
            (uint256 reserveInput, uint256 reserveOutput) = input == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
            amountInput = IERC20(input).balanceOf(address(pair)).sub(reserveInput);
            amountOutput = PangolinLibrary.getAmountOut(amountInput, reserveInput, reserveOutput);
            }
            (uint256 amount0Out, uint256 amount1Out) = input == token0 ? (uint(0), amountOutput) : (amountOutput, uint(0));
            address to = i < path.length - 2 ? PangolinLibrary.pairFor(FACTORY, output, path[i + 2]) : address(this);
            pair.swap(amount0Out, amount1Out, to, new bytes(0));
        }
    }
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline,
        address feeTo
    ) external ensure(deadline) {
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, PangolinLibrary.pairFor(FACTORY, path[0], path[1]), amountIn
        );
        address tokenOut = path[path.length - 1];
        uint256 balanceBefore = IERC20(tokenOut).balanceOf(to);
        uint256 amountOut = IERC20(tokenOut).balanceOf(address(this));
        _swapSupportingFeeOnTransferTokens(path);
        amountOut = IERC20(tokenOut).balanceOf(address(this)).sub(amountOut); // Ensures stored fees are safe

        FeeInfo storage feeInfo = feeInfos[feeTo];
        uint256 feeTotalAmount = amountOut.mul(feeInfo.feeTotal) / BIPS;

        _distribute(amountOut - feeTotalAmount, tokenOut, to, feeTo, feeInfo.feeCut, feeTotalAmount);

        require(
            IERC20(tokenOut).balanceOf(to).sub(balanceBefore) >= amountOutMin,
            "INSUFFICIENT_OUTPUT_AMOUNT"
        );
    }
    function swapExactAVAXForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline,
        address feeTo
    ) external payable ensure(deadline) {
        require(path[0] == WAVAX, "INVALID_PATH");
        IWAVAX(WAVAX).deposit{value: msg.value}();
        assert(IWAVAX(WAVAX).transfer(PangolinLibrary.pairFor(FACTORY, WAVAX, path[1]), msg.value));
        address tokenOut = path[path.length - 1];
        uint256 balanceBefore = IERC20(tokenOut).balanceOf(to);
        uint256 amountOut = IERC20(tokenOut).balanceOf(address(this));
        _swapSupportingFeeOnTransferTokens(path);
        amountOut = IERC20(tokenOut).balanceOf(address(this)).sub(amountOut); // Ensures stored fees are safe

        FeeInfo storage feeInfo = feeInfos[feeTo];
        uint256 feeTotalAmount = amountOut.mul(feeInfo.feeTotal) / BIPS;

        _distribute(amountOut - feeTotalAmount, tokenOut, to, feeTo, feeInfo.feeCut, feeTotalAmount);

        require(
            IERC20(tokenOut).balanceOf(to).sub(balanceBefore) >= amountOutMin,
            "INSUFFICIENT_OUTPUT_AMOUNT"
        );
    }
    function swapExactTokensForAVAXSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline,
        address feeTo
    ) external ensure(deadline) {
        require(path[path.length - 1] == WAVAX, "INVALID_PATH");
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, PangolinLibrary.pairFor(FACTORY, path[0], path[1]), amountIn
        );
        uint256 amountOut = IERC20(WAVAX).balanceOf(address(this));
        _swapSupportingFeeOnTransferTokens(path);
        amountOut = IERC20(WAVAX).balanceOf(address(this)).sub(amountOut); // Ensures stored fees are safe

        FeeInfo storage feeInfo = feeInfos[feeTo];
        uint256 feeTotalAmount = amountOut.mul(feeInfo.feeTotal) / BIPS;
        uint256 userAmountOut = amountOut - feeTotalAmount;
        require(userAmountOut >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");

        _distributeAVAX(userAmountOut, to, feeTo, feeInfo.feeCut, feeTotalAmount);
    }

    // **** FEE FUNCTIONS ****
    function alterManagement(address partner, address manager, bool isAllowed) external {
        require(msg.sender == owner() || msg.sender == partner, "Permission denied");
        managers[partner][manager] = isAllowed;
        emit AlterManager(partner, manager, isAllowed);
    }
    function modifyFeeCut(address partner, uint24 feeCut) external {
        require(msg.sender == owner(), "Permission denied");

        require(feeCut <= MAX_FEE_CUT, "Excessive fee cut");

        FeeInfo storage feeInfo = feeInfos[partner];
        require(feeInfo.feeCut != feeCut, "No change required");

        uint24 feeProtocol = feeInfo.feeTotal * feeCut / BIPS; // Range [ 0, MAX_FEE:200 ]
        uint24 feePartner = feeInfo.feeTotal - feeProtocol; // Range [ 0, MAX_FEE:200 ]

        feeInfo.feePartner = feePartner;
        feeInfo.feeProtocol = feeProtocol;
        feeInfo.feeCut = feeCut;
        feeInfo.initialized = true;

        emit FeeChange(partner, feePartner, feeProtocol, feeInfo.feeTotal, feeCut);
    }
    function modifyTotalFee(address partner, uint24 feeTotal) external {
        require(msg.sender == partner || msg.sender == owner() || managers[partner][msg.sender], "Permission denied");

        require(feeTotal <= MAX_FEE, "Excessive total fee");

        FeeInfo storage feeInfo = feeInfos[partner];
        require(feeInfo.feeTotal != feeTotal, "No change required");

        if (!feeInfo.initialized) {
            feeInfo.feeCut = MAX_FEE_CUT;
            feeInfo.initialized = true;
        }

        uint24 feeProtocol = feeTotal * feeInfo.feeCut / BIPS; // Range [ 0, MAX_FEE:200 ]
        uint24 feePartner = feeTotal - feeProtocol; // Range [ 0, MAX_FEE:200 ]

        feeInfo.feePartner = feePartner;
        feeInfo.feeProtocol = feeProtocol;
        feeInfo.feeTotal = feeTotal;

        emit FeeChange(partner, feePartner, feeProtocol, feeTotal, feeInfo.feeCut);
    }
    function withdrawFees(address[] calldata tokens, uint256[] calldata amounts, address to) external {
        require(msg.sender == owner(), "Permission denied");
        uint256 tokensLength = tokens.length;
        require(tokensLength == amounts.length, "Mismatched array lengths");
        for (uint256 i; i < tokensLength; ++i) {
            TransferHelper.safeTransfer(tokens[i], to, amounts[i]);
            emit FeeWithdrawn(tokens[i], amounts[i], to);
        }
    }

    // **** LIBRARY FUNCTIONS ****
    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) public pure returns (uint256 amountB) {
        return PangolinLibrary.quote(amountA, reserveA, reserveB);
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public
        pure
        returns (uint256 amountOut)
    {
        return PangolinLibrary.getAmountOut(amountIn, reserveIn, reserveOut);
    }

    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        public
        pure
        returns (uint256 amountIn)
    {
        return PangolinLibrary.getAmountIn(amountOut, reserveIn, reserveOut);
    }

    function getAmountsOut(uint256 amountIn, address[] memory path)
        public
        view
        returns (uint256[] memory amounts)
    {
        return PangolinLibrary.getAmountsOut(FACTORY, amountIn, path);
    }

    function getAmountsIn(uint256 amountOut, address[] memory path)
        public
        view
        returns (uint256[] memory amounts)
    {
        return PangolinLibrary.getAmountsIn(FACTORY, amountOut, path);
    }

}

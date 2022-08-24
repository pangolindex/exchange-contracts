pragma solidity >=0.8.0;

// SPDX-License-Identifier: MIT

interface IPangolinRouterSupportingFees {
    function FACTORY() external view returns (address);
    function WAVAX() external view returns (address);

    function MAX_FEE() external view returns (uint24);
    function FEE_FLOOR() external view returns (uint24);

    struct FeeInfo {
        uint24 feePartner;
        uint24 feeProtocol;
        uint24 feeTotal;
        uint24 feeCut;
        bool initialized;
    }

    function getFeeInfo(address feeTo) view external returns (
        uint24 feePartner,
        uint24 feeProtocol,
        uint24 feeTotal,
        uint24 feeCut,
        bool initialized
    );

    event PartnerActivated(address indexed partner, uint24 feePartner, uint24 feeProtocol, uint24 feeTotal, uint24 feeCut);
    event FeeChange(address indexed partner, uint24 feePartner, uint24 feeProtocol, uint24 feeTotal, uint24 feeCut);
    event ProtocolFee(address indexed partner, address indexed token, uint256 amount);
    event PartnerFee(address indexed partner, address indexed token, uint256 amount);
    event FeeWithdrawn(address indexed token, uint256 amount, address to);
    event FeeFloorChange(uint24 feeFloor);
    event ManagerChange(address indexed partner, address manager, bool isAllowed);

    function managers(address partner, address manager) view external returns (bool isAllowed);

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline,
        address feeTo
    ) external returns (uint[] memory amounts);
    function swapTokensForExactTokens(
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline,
        address feeTo
    ) external returns (uint[] memory amounts);
    function swapExactAVAXForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline,
        address feeTo
    ) external payable returns (uint[] memory amounts);
    function swapTokensForExactAVAX(
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline,
        address feeTo
    ) external returns (uint[] memory amounts);
    function swapExactTokensForAVAX(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline,
        address feeTo
    ) external returns (uint[] memory amounts);
    function swapAVAXForExactTokens(
        uint amountOut,
        address[] calldata path,
        address to,
        uint deadline,
        address feeTo
    ) external payable returns (uint[] memory amounts);

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline,
        address feeTo
    ) external;
    function swapExactAVAXForTokensSupportingFeeOnTransferTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline,
        address feeTo
    ) external payable;
    function swapExactTokensForAVAXSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline,
        address feeTo
    ) external;

    function activatePartner(address partner) external;
    function modifyManagement(address partner, address manager, bool isAllowed) external;
    function modifyTotalFee(address partner, uint24 feeTotal) external;
    function modifyFeeCut(address partner, uint24 feeCut) external;
    function modifyFeeFloor(uint24 feeFloor) external;
    function withdrawFees(address[] calldata tokens, uint256[] calldata amounts, address to) external;

    function quote(uint amountA, uint reserveA, uint reserveB) external pure returns (uint amountB);
    function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut) external pure returns (uint amountOut);
    function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut) external pure returns (uint amountIn);
    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
    function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts);
}

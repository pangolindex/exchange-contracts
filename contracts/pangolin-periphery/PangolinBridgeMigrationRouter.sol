pragma solidity ^0.6.6;

import "../pangolin-lib/libraries/TransferHelper.sol";
import "./interfaces/IWrappedERC20.sol";
import "./libraries/PangolinLibrary.sol";
import "../pangolin-core/interfaces/IPangolinERC20.sol";
import "./libraries/Roles.sol";
import "hardhat/console.sol";

contract PangolinBridgeMigrationRouter {
    using SafeMath for uint;
    using Roles for Roles.Role;

    Roles.Role private adminRole;
    mapping(address => address) public bridgeMigrator;

    constructor() public {
        adminRole.add(msg.sender);
    }

    // safety measure to prevent clear front-running by delayed block
    modifier ensure(uint deadline) {
        require(deadline >= block.timestamp, 'PangolinBridgeMigrationRouter: EXPIRED');
        _;
    }

    modifier onlyAdmin() {
        require(adminRole.has(msg.sender), 'PangolinBridgeMigrationRouter: Unauthorized');
        _;
    }

    function addAdmin(address account) external onlyAdmin {
        adminRole.add(account);
    }

    function removeAdmin(address account) external onlyAdmin {
        adminRole.remove(account);
    }

    function isAdmin(address account) external view onlyAdmin returns(bool) {
        return adminRole.has(account);
    }

    function addMigrator(address token, address migrator) external onlyAdmin {
        uint256 amount = IWrappedERC20(migrator).swapSupply(token);
        require(
            amount > 0,
            "The migrator doesn't have swap supply for this token"
        );
        _allowToken(token, migrator);
        bridgeMigrator[token] = migrator;
    }

    function _allowToken(address tokenAddress, address spenderAddress) internal {
        IPangolinERC20(tokenAddress).approve(spenderAddress, uint(-1));
    }

    function _addLiquidity(
        address pairToken,
        address token0,
        address token1,
        uint amountIn0,
        uint amountIn1,
        address to
    ) private returns (uint amount0, uint amount1, uint liquidityAmount) {
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

    function _rescueLiquidity(
        address liquidityPair,
        uint amount
    ) internal returns (uint amountTokenA, uint amountTokenB) {
        TransferHelper.safeTransferFrom(liquidityPair, msg.sender, liquidityPair, amount);
        (amountTokenA, amountTokenB) = IPangolinPair(liquidityPair).burn(address(this));
    }

    function _arePairsCompatible(address pairA, address pairB) internal view {
        require(pairA != address(0), "PangolinBridgeMigrationRouter::liquidityPairFrom address 0");
        require(pairA != address(0), "PangolinBridgeMigrationRouter::liquidityPairTo address 0");
        require(pairA != pairB, "PangolinBridgeMigrationRouter::cant convert to the same liquidity pairs");
        require(
            IPangolinPair(pairA).token0() == IPangolinPair(pairB).token0() ||
            IPangolinPair(pairA).token0() == IPangolinPair(pairB).token1() ||
            IPangolinPair(pairA).token1() == IPangolinPair(pairB).token0() ||
            IPangolinPair(pairA).token1() == IPangolinPair(pairB).token1(),
            "PangolinBridgeMigrationRouter::Pair does not have one token matching"
        );
    }

    function _migrateToken(
        address token,
        uint amount
    ) internal {
        IWrappedERC20(bridgeMigrator[token]).swap(token, amount);
        require(
            IWrappedERC20(bridgeMigrator[token]).balanceOf(address(this)) == amount,
            "PangolinBridgeMigrationRouter::Migration didn't yield the correct amount, reverting"
        );
    }

    function migrateToken(
        address token,
        address to,
        uint amount,
        uint deadline
    ) external ensure(deadline) {
        require(bridgeMigrator[token] != address(0), "PangolinBridgeMigrationRouter::migrator not registered for the token");
        _migrateToken(token, amount);
        TransferHelper.safeTransfer(bridgeMigrator[token], to, amount);
    }

    function migrateLiquidity(
        address liquidityPairFrom,
        address liquidityPairTo,
        address to,
        uint amount,
        uint deadline
    ) external ensure(deadline) {
        _arePairsCompatible(liquidityPairFrom, liquidityPairTo);
        address tokenToMigrate = IPangolinPair(liquidityPairFrom).token0();
        if (
            IPangolinPair(liquidityPairFrom).token0() == IPangolinPair(liquidityPairTo).token0() ||
            IPangolinPair(liquidityPairFrom).token0() == IPangolinPair(liquidityPairTo).token1()
        ) {
            tokenToMigrate = IPangolinPair(liquidityPairFrom).token1();
        }
        address newTokenAddress = bridgeMigrator[tokenToMigrate];
        require(newTokenAddress != address(0), "PangolinBridgeMigrationRouter::migrator not registered for the pair");
        console.log(newTokenAddress);
        require(
            newTokenAddress == IPangolinPair(liquidityPairTo).token0() || newTokenAddress == IPangolinPair(liquidityPairTo).token1(), 
            "PangolinBridgeMigrationRouter::pair you're trying to migrate to doesn't match the migration token"
        );

        (uint amountTokenA, uint amountTokenB) = _rescueLiquidity(liquidityPairFrom, amount);
        {
            uint amountToSwap = amountTokenA;
            if (tokenToMigrate != IPangolinPair(liquidityPairFrom).token0()) {
                amountToSwap = amountTokenB;
            }
            
        }
        
        if (IPangolinPair(liquidityPairFrom).token0() != IPangolinPair(liquidityPairTo).token0()) {
            (amountTokenA, amountTokenB) = (amountTokenB, amountTokenA);
        }

        (uint changeAmount0, uint changeAmount1, ) = _addLiquidity(
            liquidityPairTo,
            IPangolinPair(liquidityPairTo).token0(), IPangolinPair(liquidityPairTo).token1(),
            amountTokenA, amountTokenB, to
        );
        if (changeAmount0 > 0) {
            TransferHelper.safeTransfer(IPangolinPair(liquidityPairTo).token0(), to, changeAmount0);
        }
        if (changeAmount1 > 0) {
            TransferHelper.safeTransfer(IPangolinPair(liquidityPairTo).token1(), to, changeAmount1);
        }
    }

}
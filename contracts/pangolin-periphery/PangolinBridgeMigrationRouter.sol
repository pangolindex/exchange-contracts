pragma solidity ^0.7.6;

import "../pangolin-core/interfaces/IPangolinERC20.sol";
import "../pangolin-lib/libraries/TransferHelper.sol";
import "./interfaces/IBridgeToken.sol";
import "./libraries/Roles.sol";
import "./libraries/PangolinLibrary.sol";

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

    // makes sure the admin is the one calling protected methods
    modifier onlyAdmin() {
        require(adminRole.has(msg.sender), 'PangolinBridgeMigrationRouter: Unauthorized');
        _;
    }

    /**
     * @notice Given an address, this address is added to the list of admin.
     * @dev Any admin can add or remove other admins, careful.
     * @param account The address of the account.
     */
    function addAdmin(address account) external onlyAdmin {
        require(account != address(0), "PangolinBridgeMigrationRouter: Address 0 not allowed");
        adminRole.add(account);
    }

    /**
     * @notice Given an address, this address is added to the list of admin.
     * @dev Any admin can add or remove other admins, careful.
     * @param account The address of the account.
     */
    function removeAdmin(address account) external onlyAdmin {
        require(msg.sender != account, "PangolinBridgeMigrationRouter: You can't demote yourself");
        adminRole.remove(account);
    }

    /**
     * @notice Given an address, returns whether or not he's already an admin
     * @param account The address of the account.
     * @return Whether or not the account address is an admin.
     */
    function isAdmin(address account) external view returns(bool) {
        return adminRole.has(account);
    }

    /**
     * @notice Given an token, and it's migrator address, it configures the migrator for later usage
     * @param tokenAddress The ERC20 token address that will be migrated using the migrator
     * @param migratorAddress The WrappedERC20 token address that will be migrate the token
     */
    function addMigrator(address tokenAddress, address migratorAddress) external onlyAdmin {
        require(tokenAddress != address(0), "PangolinBridgeMigrationRouter: tokenAddress 0 not supported");
        require(migratorAddress != address(0), "PangolinBridgeMigrationRouter: migratorAddress 0 not supported");
        uint256 amount = IBridgeToken(migratorAddress).swapSupply(tokenAddress);
        require(
            amount > 0,
            "The migrator doesn't have swap supply for this token"
        );
        _allowToken(tokenAddress, migratorAddress);
        bridgeMigrator[tokenAddress] = migratorAddress;
    }

    /**
     * @notice Internal function to manage approval, allows an ERC20 to be spent to the maximum
     * @param tokenAddress The ERC20 token address that will be allowed to be used
     * @param spenderAddress Who's going to spend the ERC20 token
     */
    function _allowToken(address tokenAddress, address spenderAddress) internal {
        IPangolinERC20(tokenAddress).approve(spenderAddress, type(uint).max);
    }

    /**
     * @notice Internal function add liquidity on a low level, without the use of a router
     * @dev This function will try to maximize one of the tokens amount and match the other
     * one, can cause dust so consider charge backs
     * @param pairToken The pair that will receive the liquidity
     * @param token0 The first token of the pair
     * @param token1 The second token of the pair
     * @param amountIn0 The amount of first token that can be used to deposit liquidity
     * @param amountIn1 The amount of second token that can be used to deposit liquidity
     * @param to The address who will receive the liquidity
     * @return amount0 Charge back from token0
     * @return amount1 Charge back from token1
     * @return liquidityAmount Total liquidity token amount acquired
     */
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

    /**
     * @notice Internal function to remove liquidity on a low level, without the use of a router
     * @dev This function requires the user to approve this contract to transfer the liquidity pair on it's behalf
     * @param liquidityPair The pair that will have the liquidity removed
     * @param amount The amount of liquidity token that you want to rescue
     * @return amountTokenA The amount of token0 from burning liquidityPair token
     * @return amountTokenB The amount of token1 from burning liquidityPair token
     */
    function _rescueLiquidity(
        address liquidityPair,
        uint amount
    ) internal returns (uint amountTokenA, uint amountTokenB) {
        TransferHelper.safeTransferFrom(liquidityPair, msg.sender, liquidityPair, amount);
        (amountTokenA, amountTokenB) = IPangolinPair(liquidityPair).burn(address(this));
    }

    /**
     * @notice Internal function that checks if the minimum requirements are met to accept the pairs to migrate
     * @dev This function makes the main function(migrateLiquidity) cleaner, this function can revert the transaction
     * @param pairA The pair that is going to be migrated from
     * @param pairB The pair that is going to be migrated to
     */
    function _arePairsCompatible(address pairA, address pairB) internal view {
        require(pairA != address(0), "PangolinBridgeMigrationRouter: liquidityPairFrom address 0");
        require(pairA != address(0), "PangolinBridgeMigrationRouter: liquidityPairTo address 0");
        require(pairA != pairB, "PangolinBridgeMigrationRouter: Cant convert to the same liquidity pairs");
        require(
            IPangolinPair(pairA).token0() == IPangolinPair(pairB).token0() ||
            IPangolinPair(pairA).token0() == IPangolinPair(pairB).token1() ||
            IPangolinPair(pairA).token1() == IPangolinPair(pairB).token0() ||
            IPangolinPair(pairA).token1() == IPangolinPair(pairB).token1(),
            "PangolinBridgeMigrationRouter: Pair does not have one token matching"
        );
    }

    /**
     * @notice Internal function that implements the token migration
     * @dev This function only checks if the expected balance was received, it doesn't check for migrator existance
     * @param tokenAddress The ERC20 token address that will be migrated
     * @param amount The amount of the token to be migrated
     */
    function _migrateToken(
        address tokenAddress,
        uint amount
    ) internal {
        require(tokenAddress != address(0), "PangolinBridgeMigrationRouter: tokenAddress 0 not supported");
        IBridgeToken(bridgeMigrator[tokenAddress]).swap(tokenAddress, amount);
        require(
            IBridgeToken(bridgeMigrator[tokenAddress]).balanceOf(address(this)) == amount,
            "PangolinBridgeMigrationRouter: Didn't yield the correct amount"
        );
    }

    /**
     * @notice Front facing function that migrates the token
     * @dev This function includes important checks
     * @param token The ERC20 token address that will be migrated
     * @param to The address of who's receiving the token
     * @param amount The amount of the token to be migrated
     * @param deadline The deadline limit that should be met, otherwise revert to prevent front-run
     */
    function migrateToken(
        address token,
        address to,
        uint amount,
        uint deadline
    ) external ensure(deadline) {
        require(
            bridgeMigrator[token] != address(0),
            "PangolinBridgeMigrationRouter: migrator not registered"
        );
        TransferHelper.safeTransferFrom(token, msg.sender, address(this), amount);
        _migrateToken(token, amount);
        TransferHelper.safeTransfer(bridgeMigrator[token], to, amount);
    }

    /**
     * @notice Front facing function that migrates the liquidity, with permit
     * @param liquidityPairFrom The pair address to be migrated from
     * @param liquidityPairTo The pair address to be migrated to
     * @param to The address that will receive the liquidity and the charge backs
     * @param amount The amount of token liquidityPairFrom that will be migrated
     * @param deadline The deadline limit that should be met, otherwise revert to prevent front-run
     * @param v by passing param for the permit validation
     * @param r by passing param for the permit validation
     * @param s by passing param for the permit validation
     */
    function migrateLiquidityWithPermit(
        address liquidityPairFrom,
        address liquidityPairTo,
        address to,
        uint amount,
        uint deadline,
        uint8 v, bytes32 r, bytes32 s
    ) external ensure(deadline) {
        IPangolinPair(liquidityPairFrom).permit(msg.sender, address(this), amount, deadline, v, r, s);
        _migrateLiquidity(
            liquidityPairFrom,
            liquidityPairTo,
            to,
            amount
        );
    }

    /**
     * @notice Front facing function that migrates the liquidity
     * @dev This function assumes sender already gave approval to move the assets
     * @param liquidityPairFrom The pair address to be migrated from
     * @param liquidityPairTo The pair address to be migrated to
     * @param to The address that will receive the liquidity and the charge backs
     * @param amount The amount of token liquidityPairFrom that will be migrated
     * @param deadline The deadline limit that should be met, otherwise revert to prevent front-run
     */
    function migrateLiquidity(
        address liquidityPairFrom,
        address liquidityPairTo,
        address to,
        uint amount,
        uint deadline
    ) external ensure(deadline) {
        _migrateLiquidity(
            liquidityPairFrom,
            liquidityPairTo,
            to,
            amount
        );
    }

    /**
     * @notice This was extracted into a internal method to use with both migrateLiquidity and with permit
     * @dev This function includes important checks
     * @param liquidityPairFrom The pair address to be migrated from
     * @param liquidityPairTo The pair address to be migrated to
     * @param to The address that will receive the liquidity and the charge backs
     * @param amount The amount of token liquidityPairFrom that will be migrated
     */
    function _migrateLiquidity(
        address liquidityPairFrom,
        address liquidityPairTo,
        address to,
        uint amount
    ) internal {
        _arePairsCompatible(liquidityPairFrom, liquidityPairTo);
        address tokenToMigrate = IPangolinPair(liquidityPairFrom).token0();
        if (
            IPangolinPair(liquidityPairFrom).token0() == IPangolinPair(liquidityPairTo).token0() ||
            IPangolinPair(liquidityPairFrom).token0() == IPangolinPair(liquidityPairTo).token1()
        ) {
            tokenToMigrate = IPangolinPair(liquidityPairFrom).token1();
        }
        address newTokenAddress = bridgeMigrator[tokenToMigrate];
        require(
            newTokenAddress != address(0),
            "PangolinBridgeMigrationRouter: Migrator not registered for the pair"
        );
        require(
            newTokenAddress == IPangolinPair(liquidityPairTo).token0() ||
            newTokenAddress == IPangolinPair(liquidityPairTo).token1(),
            "PangolinBridgeMigrationRouter: Pair doesn't match the migration token"
        );

        (uint amountTokenA, uint amountTokenB) = _rescueLiquidity(liquidityPairFrom, amount);
        {
            uint amountToSwap = amountTokenA;
            if (tokenToMigrate != IPangolinPair(liquidityPairFrom).token0()) {
                amountToSwap = amountTokenB;
            }
            _migrateToken(tokenToMigrate, amountToSwap);
        }
        if (IPangolinPair(liquidityPairFrom).token0() != IPangolinPair(liquidityPairTo).token0() &&
            IPangolinPair(liquidityPairFrom).token1() != IPangolinPair(liquidityPairTo).token1()
        ) {
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

    /**
     * @notice Internal function that simulates the amount received from the liquidity burn
     * @dev This function is a support function that can be used by the front-end to show possible charge back
     * @param pairAddress The pair address that will be burned(simulated)
     * @param amount The amount of the liquidity token to be burned(simulated)
     * @return amount0 Amounts of token0 acquired from burning the pairAddress token
     * @return amount1 Amounts of token1 acquired from burning the pairAddress token
     */
    function _calculateRescueLiquidity(address pairAddress, uint amount) internal view returns (uint amount0, uint amount1) {
        (uint112 reserves0, uint112 reserves1, ) = IPangolinPair(pairAddress).getReserves();
        uint totalSupply = IPangolinPair(pairAddress).totalSupply();
        amount0 = amount.mul(reserves0) / totalSupply;
        amount1 = amount.mul(reserves1) / totalSupply;
    }

    /**
     * @notice Front facing function that computes the possible charge back from the migration
     * @dev No need to be extra careful as this is only a view function
     * @param liquidityPairFrom The pair address that will be migrated from(simulated)
     * @param liquidityPairTo The pair address that will be migrated to(simulated)
     * @param amount The amount of the liquidity token to be migrated(simulated)
     * @return amount0 Amount of token0 will be charged back after the migration
     * @return amount1 Amount of token1 will be charged back after the migration
     */
    function calculateChargeBack(
        address liquidityPairFrom,
        address liquidityPairTo,
        uint amount
    ) external view returns (uint amount0, uint amount1) {
        require(liquidityPairFrom != address(0), "PangolinBridgeMigrationRouter: liquidityPairFrom address 0 not supported");
        require(liquidityPairTo != address(0), "PangolinBridgeMigrationRouter: liquidityPairTo address 0 not supported");
        (uint amountIn0, uint amountIn1) = _calculateRescueLiquidity(liquidityPairFrom, amount);
        if (IPangolinPair(liquidityPairFrom).token0() != IPangolinPair(liquidityPairTo).token0() &&
            IPangolinPair(liquidityPairFrom).token1() != IPangolinPair(liquidityPairTo).token1()
        ) {
            (amountIn0, amountIn1) = (amountIn1, amountIn0);
        }
        (uint112 reserve0, uint112 reserve1,) = IPangolinPair(liquidityPairTo).getReserves();
        uint quote0 = amountIn0;
        uint quote1 = PangolinLibrary.quote(amountIn0, reserve0, reserve1);
        if (quote1 > amountIn1) {
            quote1 = amountIn1;
            quote0 = PangolinLibrary.quote(amountIn1, reserve1, reserve0);
        }
        amount0 = amountIn0 - quote0;
        amount1 = amountIn1 - quote1;
    }

}
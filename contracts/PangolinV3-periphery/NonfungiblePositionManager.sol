// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import '../PangolinV3-core/interfaces/IPangolinV3Pool.sol';
import '../PangolinV3-core/libraries/FixedPoint128.sol';
import '../PangolinV3-core/libraries/FullMath.sol';
import '../PangolinV3-rewarder/interfaces/IPangolinV3Rewarder.sol';

import './interfaces/INonfungiblePositionManager.sol';
import './libraries/PositionKey.sol';
import './libraries/PoolAddress.sol';
import './base/LiquidityManagement.sol';
import './base/PeripheryImmutableState.sol';
import './base/Multicall.sol';
import './base/ERC721Permit.sol';
import './base/SelfPermit.sol';
import './base/PoolInitializer.sol';

/// @title NFT positions
/// @notice Wraps Pangolin V3 positions in the ERC721 non-fungible token interface
contract NonfungiblePositionManager is
    INonfungiblePositionManager,
    Multicall,
    ERC721Permit,
    PeripheryImmutableState,
    PoolInitializer,
    LiquidityManagement,
    SelfPermit
{
    // details about the Pangolin V3 position
    struct Position {
        // the nonce for permits
        uint96 nonce;
        // the address that is approved for spending this token
        address operator;
        // the ID of the pool with which this token is connected
        uint80 poolId;
        // the tick range of the position
        int24 tickLower;
        int24 tickUpper;
        // the liquidity of the position
        uint128 liquidity;
        // the fee growth of the aggregate position as of the last action on the individual position
        uint256 feeGrowthInside0LastX128;
        uint256 feeGrowthInside1LastX128;
        // how many uncollected tokens are owed to the position, as of the last computation
        uint128 tokensOwed0;
        uint128 tokensOwed1;
        // reward stuff
        uint192 rewardPerLiquidityInsideLastX64;
        uint32 rewardLastUpdated;
        uint32 rewardLastCollected;
        uint256 rewardOwed;
    }

    /// @dev IDs of pools assigned by this contract
    mapping(address => uint80) private _poolIds;

    /// @dev Pool keys by pool ID, to save on SSTOREs for position data
    mapping(uint80 => PoolAddress.PoolKey) private _poolIdToPoolKey;

    /// @dev The token ID position data
    mapping(uint256 => Position) private _positions;

    /// @dev The ID of the next token that will be minted. Skips 0
    uint176 private _nextId = 1;
    /// @dev The ID of the next pool that is used for the first time. Skips 0
    uint80 private _nextPoolId = 1;

    /// @dev The address of the token descriptor contract, which handles generating token URIs for position tokens
    address private _tokenDescriptor;

    /// @dev The address that will send rewards to the user based on the amount in `claimReward` function
    address private _pangolinRewarder;

    constructor(
        address _factory,
        address _WETH9,
        address _tokenDescriptor_,
        address _pangolinRewarder_
    ) ERC721Permit('Pangolin V3 Positions NFT', 'PNV3-POS', '1') PeripheryImmutableState(_factory, _WETH9) {
        _tokenDescriptor = _tokenDescriptor_;
        _pangolinRewarder = _pangolinRewarder_;
    }

    /// @inheritdoc INonfungiblePositionManager
    function positions(uint256 tokenId)
        external
        view
        override
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        )
    {
        Position memory position = _positions[tokenId];
        require(position.poolId != 0);
        PoolAddress.PoolKey memory poolKey = _poolIdToPoolKey[position.poolId];
        return (
            position.nonce,
            position.operator,
            poolKey.token0,
            poolKey.token1,
            poolKey.fee,
            position.tickLower,
            position.tickUpper,
            position.liquidity,
            position.feeGrowthInside0LastX128,
            position.feeGrowthInside1LastX128,
            position.tokensOwed0,
            position.tokensOwed1
        );
    }

    /// @inheritdoc INonfungiblePositionManager
    function positionReward(uint256 tokenId)
    external
    view
    override
    returns (
        uint192 rewardPerLiquidityInsideLastX64,
        uint32 rewardLastUpdated,
        uint32 rewardLastCollected,
        uint256 totalReward
    )
    {
        Position memory position = _positions[tokenId];
        require(position.poolId != 0);
        PoolAddress.PoolKey memory poolKey = _poolIdToPoolKey[position.poolId];
        IPangolinV3Pool pool = IPangolinV3Pool(PoolAddress.computeAddress(factory, poolKey));

        (, , , uint192 rewardPerLiquidityInsideCurrentX64) =
            pool.snapshotCumulativesInside(position.tickLower, position.tickUpper);

        uint256 instantaneousReward = FullMath.mulDiv(
            rewardPerLiquidityInsideCurrentX64 - position.rewardPerLiquidityInsideLastX64,
            position.liquidity,
            2**64
        );

        totalReward = position.rewardOwed + instantaneousReward;
        return (
            position.rewardPerLiquidityInsideLastX64,
            position.rewardLastUpdated,
            position.rewardLastCollected,
            totalReward
        );
    }

    /// @dev Caches a pool key
    function cachePoolKey(address pool, PoolAddress.PoolKey memory poolKey) private returns (uint80 poolId) {
        poolId = _poolIds[pool];
        if (poolId == 0) {
            _poolIds[pool] = (poolId = _nextPoolId++);
            _poolIdToPoolKey[poolId] = poolKey;
        }
    }

    /// @inheritdoc INonfungiblePositionManager
    function mint(MintParams calldata params)
        external
        payable
        override
        checkDeadline(params.deadline)
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        IPangolinV3Pool pool;
        (liquidity, amount0, amount1, pool) = addLiquidity(
            AddLiquidityParams({
                token0: params.token0,
                token1: params.token1,
                fee: params.fee,
                recipient: address(this),
                tickLower: params.tickLower,
                tickUpper: params.tickUpper,
                amount0Desired: params.amount0Desired,
                amount1Desired: params.amount1Desired,
                amount0Min: params.amount0Min,
                amount1Min: params.amount1Min
            })
        );

        _mint(params.recipient, (tokenId = _nextId++));

        bytes32 positionKey = PositionKey.compute(address(this), params.tickLower, params.tickUpper);
        (, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, , ) = pool.positions(positionKey);

        // idempotent set
        uint80 poolId =
            cachePoolKey(
                address(pool),
                PoolAddress.PoolKey({token0: params.token0, token1: params.token1, fee: params.fee})
            );

        _positions[tokenId] = Position({
            nonce: 0,
            operator: address(0),
            poolId: poolId,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidity: liquidity,
            feeGrowthInside0LastX128: feeGrowthInside0LastX128,
            feeGrowthInside1LastX128: feeGrowthInside1LastX128,
            tokensOwed0: 0,
            tokensOwed1: 0,
            rewardPerLiquidityInsideLastX64: 0,
            rewardLastUpdated: 0,
            rewardLastCollected: 0,
            rewardOwed: 0
        });

        Position storage position = _positions[tokenId];

        _updateReward(position, pool);

        emit IncreaseLiquidity(tokenId, liquidity, amount0, amount1);
    }

    function _isAuthorizedForToken(uint256 tokenId) internal view {
        require(_isApprovedOrOwner(msg.sender, tokenId), 'Na');
    }
    modifier isAuthorizedForToken(uint256 tokenId) {
        _isAuthorizedForToken(tokenId);
        _;
    }

    function _onlyFactoryOwner() internal view {
        require(msg.sender == IPangolinV3Factory(factory).owner());
    }
    modifier onlyFactoryOwner() {
        _onlyFactoryOwner();
        _;
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, IERC721Metadata) returns (string memory) {}

    // save bytecode by removing implementation of unused method
    function baseURI() public pure override returns (string memory) {}

    /// @inheritdoc INonfungiblePositionManager
    function increaseLiquidity(IncreaseLiquidityParams calldata params)
        external
        payable
        override
        checkDeadline(params.deadline)
        returns (
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        Position storage position = _positions[params.tokenId];

        PoolAddress.PoolKey memory poolKey = _poolIdToPoolKey[position.poolId];

        IPangolinV3Pool pool;
        (liquidity, amount0, amount1, pool) = addLiquidity(
            AddLiquidityParams({
                token0: poolKey.token0,
                token1: poolKey.token1,
                fee: poolKey.fee,
                tickLower: position.tickLower,
                tickUpper: position.tickUpper,
                amount0Desired: params.amount0Desired,
                amount1Desired: params.amount1Desired,
                amount0Min: params.amount0Min,
                amount1Min: params.amount1Min,
                recipient: address(this)
            })
        );

        bytes32 positionKey = PositionKey.compute(address(this), position.tickLower, position.tickUpper);

        // this is now updated to the current transaction
        (, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, , ) = pool.positions(positionKey);

        position.tokensOwed0 += uint128(
            FullMath.mulDiv(
                feeGrowthInside0LastX128 - position.feeGrowthInside0LastX128,
                position.liquidity,
                FixedPoint128.Q128
            )
        );
        position.tokensOwed1 += uint128(
            FullMath.mulDiv(
                feeGrowthInside1LastX128 - position.feeGrowthInside1LastX128,
                position.liquidity,
                FixedPoint128.Q128
            )
        );

        _updateReward(position, pool); // must use position.liquidity before update

        position.feeGrowthInside0LastX128 = feeGrowthInside0LastX128;
        position.feeGrowthInside1LastX128 = feeGrowthInside1LastX128;
        position.liquidity += liquidity;

        emit IncreaseLiquidity(params.tokenId, liquidity, amount0, amount1);
    }

    /// @inheritdoc INonfungiblePositionManager
    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        payable
        override
        isAuthorizedForToken(params.tokenId)
        checkDeadline(params.deadline)
        returns (uint256 amount0, uint256 amount1)
    {
        require(params.liquidity > 0);
        Position storage position = _positions[params.tokenId];

        uint128 positionLiquidity = position.liquidity;
        require(positionLiquidity >= params.liquidity);

        PoolAddress.PoolKey memory poolKey = _poolIdToPoolKey[position.poolId];
        IPangolinV3Pool pool = IPangolinV3Pool(PoolAddress.computeAddress(factory, poolKey));

        // we must update reward before burn otherwise it reverts if ticks get unintialized
        _updateReward(position, pool);

        (amount0, amount1) = pool.burn(position.tickLower, position.tickUpper, params.liquidity);

        require(amount0 >= params.amount0Min && amount1 >= params.amount1Min);

        bytes32 positionKey = PositionKey.compute(address(this), position.tickLower, position.tickUpper);
        // this is now updated to the current transaction
        (, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, , ) = pool.positions(positionKey);

        position.tokensOwed0 +=
            uint128(amount0) +
            uint128(
                FullMath.mulDiv(
                    feeGrowthInside0LastX128 - position.feeGrowthInside0LastX128,
                    positionLiquidity,
                    FixedPoint128.Q128
                )
            );
        position.tokensOwed1 +=
            uint128(amount1) +
            uint128(
                FullMath.mulDiv(
                    feeGrowthInside1LastX128 - position.feeGrowthInside1LastX128,
                    positionLiquidity,
                    FixedPoint128.Q128
                )
            );

        position.feeGrowthInside0LastX128 = feeGrowthInside0LastX128;
        position.feeGrowthInside1LastX128 = feeGrowthInside1LastX128;
        // subtraction is safe because we checked positionLiquidity is gte params.liquidity
        position.liquidity = positionLiquidity - params.liquidity;

        emit DecreaseLiquidity(params.tokenId, params.liquidity, amount0, amount1);
    }

    /// @inheritdoc INonfungiblePositionManager
    function collect(CollectParams calldata params)
        external
        payable
        override
        isAuthorizedForToken(params.tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        require(params.amount0Max > 0 || params.amount1Max > 0);
        // allow collecting to the nft position manager address with address 0
        address recipient = params.recipient == address(0) ? address(this) : params.recipient;

        Position storage position = _positions[params.tokenId];

        PoolAddress.PoolKey memory poolKey = _poolIdToPoolKey[position.poolId];

        IPangolinV3Pool pool = IPangolinV3Pool(PoolAddress.computeAddress(factory, poolKey));

        (uint128 tokensOwed0, uint128 tokensOwed1) = (position.tokensOwed0, position.tokensOwed1);

        // trigger an update of the position fees owed and fee growth snapshots if it has any liquidity
        if (position.liquidity > 0) {
            pool.burn(position.tickLower, position.tickUpper, 0);
            (, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, , ) =
                pool.positions(PositionKey.compute(address(this), position.tickLower, position.tickUpper));

            tokensOwed0 += uint128(
                FullMath.mulDiv(
                    feeGrowthInside0LastX128 - position.feeGrowthInside0LastX128,
                    position.liquidity,
                    FixedPoint128.Q128
                )
            );
            tokensOwed1 += uint128(
                FullMath.mulDiv(
                    feeGrowthInside1LastX128 - position.feeGrowthInside1LastX128,
                    position.liquidity,
                    FixedPoint128.Q128
                )
            );

            position.feeGrowthInside0LastX128 = feeGrowthInside0LastX128;
            position.feeGrowthInside1LastX128 = feeGrowthInside1LastX128;
        }

        // compute the arguments to give to the pool#collect method
        (uint128 amount0Collect, uint128 amount1Collect) =
            (
                params.amount0Max > tokensOwed0 ? tokensOwed0 : params.amount0Max,
                params.amount1Max > tokensOwed1 ? tokensOwed1 : params.amount1Max
            );

        // the actual amounts collected are returned
        (amount0, amount1) = pool.collect(
            recipient,
            position.tickLower,
            position.tickUpper,
            amount0Collect,
            amount1Collect
        );

        // sometimes there will be a few less wei than expected due to rounding down in core, but we just subtract the full amount expected
        // instead of the actual amount so we can burn the token
        (position.tokensOwed0, position.tokensOwed1) = (tokensOwed0 - amount0Collect, tokensOwed1 - amount1Collect);

        emit Collect(params.tokenId, recipient, amount0Collect, amount1Collect);
    }

    /// @inheritdoc INonfungiblePositionManager
    function claimReward(uint256 tokenId, address recipient) external payable override isAuthorizedForToken(tokenId) {
        require(recipient != address(0));

        Position storage position = _positions[tokenId];

        PoolAddress.PoolKey memory poolKey = _poolIdToPoolKey[position.poolId];
        IPangolinV3Pool pool = IPangolinV3Pool(PoolAddress.computeAddress(factory, poolKey));

        _updateReward(position, pool);

        uint256 rewardOwed = position.rewardOwed;
        uint32 rewardLastCollected = _clampedTimestamp();

        position.rewardOwed = 0;
        position.rewardLastCollected = rewardLastCollected;

        IPangolinV3Rewarder(_pangolinRewarder).claimReward(
            recipient,
            rewardOwed,
            tokenId,
            PoolAddress.computeAddress(factory, _poolIdToPoolKey[position.poolId]),
            position.rewardLastUpdated,
            rewardLastCollected
        );
    }

    /// @inheritdoc INonfungiblePositionManager
    function burn(uint256 tokenId) external payable override isAuthorizedForToken(tokenId) {
        Position storage position = _positions[tokenId];
        require(
            position.liquidity == 0 &&
            position.tokensOwed0 == 0 &&
            position.tokensOwed1 == 0 &&
            position.rewardOwed == 0
        );
        delete _positions[tokenId];
        _burn(tokenId);
    }

    function updateRewardManager(address _pangolinRewarder_) external payable override onlyFactoryOwner {
        _pangolinRewarder = _pangolinRewarder_;
    }

    function _clampedTimestamp() internal view returns (uint32) {
        return block.timestamp > type(uint32).max ? type(uint32).max : uint32(block.timestamp);
    }

    function _updateReward(Position storage position, IPangolinV3Pool pool) internal {
        (, , , uint192 rewardPerLiquidityInsideCurrentX64) =
            pool.snapshotCumulativesInside(position.tickLower, position.tickUpper);

        if (position.rewardPerLiquidityInsideLastX64 >= rewardPerLiquidityInsideCurrentX64) {
            position.rewardLastUpdated = _clampedTimestamp();
            return;
        }

        if (position.rewardLastUpdated != 0) {
            position.rewardOwed += FullMath.mulDiv(
                rewardPerLiquidityInsideCurrentX64 - position.rewardPerLiquidityInsideLastX64,
                position.liquidity,
                2**64
            );
        }

        position.rewardPerLiquidityInsideLastX64 = rewardPerLiquidityInsideCurrentX64;
        position.rewardLastUpdated = _clampedTimestamp();
    }


    function _getAndIncrementNonce(uint256 tokenId) internal override returns (uint256) {
        return uint256(_positions[tokenId].nonce++);
    }

    /// @inheritdoc IERC721
    function getApproved(uint256 tokenId) public view override(ERC721, IERC721) returns (address) {
        require(_exists(tokenId));

        return _positions[tokenId].operator;
    }

    /// @dev Overrides _approve to use the operator in the position, which is packed with the position permit nonce
    function _approve(address to, uint256 tokenId) internal override(ERC721) {
        _positions[tokenId].operator = to;
        emit Approval(ownerOf(tokenId), to, tokenId);
    }
}
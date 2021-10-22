pragma solidity ^0.7.6;

import "openzeppelin-contracts-legacy/access/Ownable.sol";
import "openzeppelin-contracts-legacy/math/SafeMath.sol";
import "openzeppelin-contracts-legacy/utils/EnumerableSet.sol";
import "openzeppelin-contracts-legacy/utils/ReentrancyGuard.sol";

import "./StakingRewards.sol";

/**
 * Contract to distribute PNG tokens to whitelisted trading pairs. After deploying,
 * whitelist the desired pairs and set the avaxPngPair. When initial administration
 * is complete. Ownership should be transferred to the Timelock governance contract.
 */
contract LiquidityPoolManagerV2 is Ownable, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeMath for uint;

    // Whitelisted pairs that offer PNG rewards
    // Note: AVAX/PNG is an AVAX pair
    EnumerableSet.AddressSet private avaxPairs;
    EnumerableSet.AddressSet private pngPairs;

    // Maps pairs to their associated StakingRewards contract
    mapping(address => address) public stakes;

    // Map of pools to weights
    mapping(address => uint) public weights;

    // Fields to control potential fee splitting
    bool public splitPools;
    uint public avaxSplit;
    uint public pngSplit;

    // Known contract addresses for WAVAX and PNG
    address public wavax;
    address public png;

    // AVAX/PNG pair used to determine PNG liquidity
    address public avaxPngPair;

    // TreasuryVester contract that distributes PNG
    address public treasuryVester;

    uint public numPools = 0;

    bool private readyToDistribute = false;

    // Tokens to distribute to each pool. Indexed by avaxPairs then pngPairs.
    uint[] public distribution;

    uint public unallocatedPng = 0;

    constructor(address wavax_,
                address png_,
                address treasuryVester_) {
        require(wavax_ != address(0) && png_ != address(0) && treasuryVester_ != address(0),
                "LiquidityPoolManager::constructor: Arguments can't be the zero address");
        wavax = wavax_;
        png = png_;
        treasuryVester = treasuryVester_;
    }

    /**
     * Check if the given pair is a whitelisted pair
     *
     * Args:
     *   pair: pair to check if whitelisted
     *
     * Return: True if whitelisted
     */
    function isWhitelisted(address pair) public view returns (bool) {
        return avaxPairs.contains(pair) || pngPairs.contains(pair);
    }

    /**
     * Check if the given pair is a whitelisted AVAX pair. The AVAX/PNG pair is
     * considered an AVAX pair.
     *
     * Args:
     *   pair: pair to check
     *
     * Return: True if whitelisted and pair contains AVAX
     */
    function isAvaxPair(address pair) external view returns (bool) {
        return avaxPairs.contains(pair);
    }

    /**
     * Check if the given pair is a whitelisted PNG pair. The AVAX/PNG pair is
     * not considered a PNG pair.
     *
     * Args:
     *   pair: pair to check
     *
     * Return: True if whitelisted and pair contains PNG but is not AVAX/PNG pair
     */
    function isPngPair(address pair) external view returns (bool) {
        return pngPairs.contains(pair);
    }

    /**
     * Sets the AVAX/PNG pair. Pair's tokens must be AVAX and PNG.
     *
     * Args:
     *   pair: AVAX/PNG pair
     */
    function setAvaxPngPair(address avaxPngPair_) external onlyOwner {
        require(avaxPngPair_ != address(0), 'LiquidityPoolManager::setAvaxPngPair: Pool cannot be the zero address');
        avaxPngPair = avaxPngPair_;
    }

    /**
     * Adds a new whitelisted liquidity pool pair. Generates a staking contract.
     * Liquidity providers may stake this liquidity provider reward token and
     * claim PNG rewards proportional to their stake. Pair must contain either
     * AVAX or PNG. Associates a weight with the pair. Rewards are distributed
     * to the pair proportionally based on its share of the total weight.
     *
     * Args:
     *   pair: pair to whitelist
     *   weight: how heavily to distribute rewards to this pool relative to other
     *     pools
     */
    function addWhitelistedPool(address pair, uint weight) external onlyOwner {
        require(!readyToDistribute,
                'LiquidityPoolManager::addWhitelistedPool: Cannot add pool between calculating and distributing returns');
        require(pair != address(0), 'LiquidityPoolManager::addWhitelistedPool: Pool cannot be the zero address');
        require(isWhitelisted(pair) == false, 'LiquidityPoolManager::addWhitelistedPool: Pool already whitelisted');
        require(weight > 0, 'LiquidityPoolManager::addWhitelistedPool: Weight cannot be zero');

        address token0 = IPangolinPair(pair).token0();
        address token1 = IPangolinPair(pair).token1();

        require(token0 != token1, 'LiquidityPoolManager::addWhitelistedPool: Tokens cannot be identical');

        // Create the staking contract and associate it with the pair
        address stakeContract = address(new StakingRewards(png, pair));
        stakes[pair] = stakeContract;

        weights[pair] = weight;

        // Add as an AVAX or PNG pair
        if (token0 == png || token1 == png) {
            require(pngPairs.add(pair), 'LiquidityPoolManager::addWhitelistedPool: Pair add failed');
        } else if (token0 == wavax || token1 == wavax) {
            require(avaxPairs.add(pair), 'LiquidityPoolManager::addWhitelistedPool: Pair add failed');
        } else {
            // The governance contract can be used to deploy an altered
            // LiquidityPoolManager if non-AVAX/PNG pools are desired.
            revert("LiquidityPoolManager::addWhitelistedPool: No AVAX or PNG in the pair");
        }

        numPools = numPools.add(1);
    }

    /**
     * Delists a whitelisted pool. Liquidity providers will not receiving future rewards.
     * Already vested funds can still be claimed. Re-whitelisting a delisted pool will
     * deploy a new staking contract.
     *
     * Args:
     *   pair: pair to remove from whitelist
     */
    function removeWhitelistedPool(address pair) external onlyOwner {
        require(!readyToDistribute,
                'LiquidityPoolManager::removeWhitelistedPool: Cannot remove pool between calculating and distributing returns');
        require(isWhitelisted(pair), 'LiquidityPoolManager::removeWhitelistedPool: Pool not whitelisted');

        address token0 = IPangolinPair(pair).token0();
        address token1 = IPangolinPair(pair).token1();

        stakes[pair] = address(0);
        weights[pair] = 0;

        if (token0 == png || token1 == png) {
            require(pngPairs.remove(pair), 'LiquidityPoolManager::removeWhitelistedPool: Pair remove failed');
        } else {
            require(avaxPairs.remove(pair), 'LiquidityPoolManager::removeWhitelistedPool: Pair remove failed');
        }
        numPools = numPools.sub(1);
    }

    /**
     * Adjust the weight of an existing pool
     *
     * Args:
     *   pair: pool to adjust weight of
     *   weight: new weight
     */
    function changeWeight(address pair, uint weight) external onlyOwner {
        require(weights[pair] > 0, 'LiquidityPoolManager::changeWeight: Pair not whitelisted');
        require(weight > 0, 'LiquidityPoolManager::changeWeight: Remove pool instead');
        weights[pair] = weight;
    }

    /**
     * Activates the fee split mechanism. Divides rewards between AVAX
     * and PNG pools regardless of liquidity. AVAX and PNG pools will
     * receive a fixed proportion of the pool rewards. The AVAX and PNG
     * splits should correspond to percentage of rewards received for
     * each and must add up to 100. For the purposes of fee splitting,
     * the AVAX/PNG pool is a PNG pool. This method can also be used to
     * change the split ratio after fee splitting has been activated.
     *
     * Args:
     *   avaxSplit: Percent of rewards to distribute to AVAX pools
     *   pngSplit: Percent of rewards to distribute to PNG pools
     */
    function activateFeeSplit(uint avaxSplit_, uint pngSplit_) external onlyOwner {
        require(avaxSplit_.add(pngSplit_) == 100, "LiquidityPoolManager::activateFeeSplit: Split doesn't add to 100");
        require(!(avaxSplit_ == 100 || pngSplit_ == 100), "LiquidityPoolManager::activateFeeSplit: Split can't be 100/0");
        splitPools = true;
        avaxSplit = avaxSplit_;
        pngSplit = pngSplit_;
    }

    /**
     * Deactivates fee splitting.
     */
    function deactivateFeeSplit() external onlyOwner {
        require(splitPools, "LiquidityPoolManager::deactivateFeeSplit: Fee split not activated");
        splitPools = false;
        avaxSplit = 0;
        pngSplit = 0;
    }

    /**
     * Calculates the amount of liquidity in the pair. For an AVAX pool, the liquidity in the
     * pair is two times the amount of AVAX. Only works for AVAX pairs.
     *
     * Args:
     *   pair: AVAX pair to get liquidity in
     *
     * Returns: the amount of liquidity in the pool in units of AVAX
     */
    function getAvaxLiquidity(address pair) public view returns (uint) {
        (uint reserve0, uint reserve1, ) = IPangolinPair(pair).getReserves();

        uint liquidity = 0;

        // add the avax straight up
        if (IPangolinPair(pair).token0() == wavax) {
            liquidity = liquidity.add(reserve0);
        } else {
            require(IPangolinPair(pair).token1() == wavax, 'LiquidityPoolManager::getAvaxLiquidity: One of the tokens in the pair must be WAVAX');
            liquidity = liquidity.add(reserve1);
        }
        liquidity = liquidity.mul(2);
        return liquidity;
    }

    /**
     * Calculates the amount of liquidity in the pair. For a PNG pool, the liquidity in the
     * pair is two times the amount of PNG multiplied by the price of AVAX per PNG. Only
     * works for PNG pairs.
     *
     * Args:
     *   pair: PNG pair to get liquidity in
     *   conversionFactor: the price of AVAX to PNG
     *
     * Returns: the amount of liquidity in the pool in units of AVAX
     */
    function getPngLiquidity(address pair, uint conversionFactor) public view returns (uint) {
        (uint reserve0, uint reserve1, ) = IPangolinPair(pair).getReserves();

        uint liquidity = 0;

        // add the png straight up
        if (IPangolinPair(pair).token0() == png) {
            liquidity = liquidity.add(reserve0);
        } else {
            require(IPangolinPair(pair).token1() == png, 'LiquidityPoolManager::getPngLiquidity: One of the tokens in the pair must be PNG');
            liquidity = liquidity.add(reserve1);
        }

        uint oneToken = 1e18;
        liquidity = liquidity.mul(conversionFactor).mul(2).div(oneToken);
        return liquidity;
    }

    /**
     * Calculates the price of swapping AVAX for 1 PNG
     *
     * Returns: the price of swapping AVAX for 1 PNG
     */
    function getAvaxPngRatio() public view returns (uint conversionFactor) {
        require(!(avaxPngPair == address(0)), "LiquidityPoolManager::getAvaxPngRatio: No AVAX-PNG pair set");
        (uint reserve0, uint reserve1, ) = IPangolinPair(avaxPngPair).getReserves();

        if (IPangolinPair(avaxPngPair).token0() == wavax) {
            conversionFactor = quote(reserve1, reserve0);
        } else {
            conversionFactor = quote(reserve0, reserve1);
        }
    }

    /**
     * Determine how the vested PNG allocation will be distributed to the liquidity
     * pool staking contracts. Must be called before distributeTokens(). Tokens are
     * distributed to pools based on relative liquidity proportional to total
     * liquidity. Should be called after vestAllocation()/
     */
    function calculateReturns() public {
        require(!readyToDistribute, 'LiquidityPoolManager::calculateReturns: Previous returns not distributed. Call distributeTokens()');
        require(unallocatedPng > 0, 'LiquidityPoolManager::calculateReturns: No PNG to allocate. Call vestAllocation().');
        if (pngPairs.length() > 0) {
            require(!(avaxPngPair == address(0)), 'LiquidityPoolManager::calculateReturns: Avax/PNG Pair not set');
        }

        // Calculate total liquidity
        distribution = new uint[](numPools);
        uint avaxLiquidity = 0;
        uint pngLiquidity = 0;

        // Add liquidity from AVAX pairs
        for (uint i = 0; i < avaxPairs.length(); i++) {
            address pair = avaxPairs.at(i);
            uint pairLiquidity = getAvaxLiquidity(pair);
            uint weightedLiquidity = pairLiquidity.mul(weights[pair]);
            distribution[i] = weightedLiquidity;
            avaxLiquidity = SafeMath.add(avaxLiquidity, weightedLiquidity);
        }

        // Add liquidity from PNG pairs
        if (pngPairs.length() > 0) {
            uint conversionRatio = getAvaxPngRatio();
            for (uint i = 0; i < pngPairs.length(); i++) {
                address pair = pngPairs.at(i);
                uint pairLiquidity = getPngLiquidity(pair, conversionRatio);
                uint weightedLiquidity = pairLiquidity.mul(weights[pair]);
                distribution[i + avaxPairs.length()] = weightedLiquidity;
                pngLiquidity = SafeMath.add(pngLiquidity, weightedLiquidity);
            }
        }

        // Calculate tokens for each pool
        uint transferred = 0;
        if (splitPools) {
            uint avaxAllocatedPng = unallocatedPng.mul(avaxSplit).div(100);
            uint pngAllocatedPng = unallocatedPng.sub(avaxAllocatedPng);

            for (uint i = 0; i < avaxPairs.length(); i++) {
                uint pairTokens = distribution[i].mul(avaxAllocatedPng).div(avaxLiquidity);
                distribution[i] = pairTokens;
                transferred = transferred.add(pairTokens);
            }

            if (pngPairs.length() > 0) {
                uint conversionRatio = getAvaxPngRatio();
                for (uint i = 0; i < pngPairs.length(); i++) {
                    uint pairTokens = distribution[i + avaxPairs.length()].mul(pngAllocatedPng).div(pngLiquidity);
                    distribution[i + avaxPairs.length()] = pairTokens;
                    transferred = transferred.add(pairTokens);
                }
            }
        } else {
            uint totalLiquidity = avaxLiquidity.add(pngLiquidity);

            for (uint i = 0; i < distribution.length; i++) {
                uint pairTokens = distribution[i].mul(unallocatedPng).div(totalLiquidity);
                distribution[i] = pairTokens;
                transferred = transferred.add(pairTokens);
            }
        }
        readyToDistribute = true;
    }

    /**
     * After token distributions have been calculated, actually distribute the vested PNG
     * allocation to the staking pools. Must be called after calculateReturns().
     */
    function distributeTokens() public nonReentrant {
        require(readyToDistribute, 'LiquidityPoolManager::distributeTokens: Previous returns not allocated. Call calculateReturns()');
        readyToDistribute = false;
        address stakeContract;
        uint rewardTokens;
        for (uint i = 0; i < distribution.length; i++) {
            if (i < avaxPairs.length()) {
                stakeContract = stakes[avaxPairs.at(i)];
            } else {
                stakeContract = stakes[pngPairs.at(i - avaxPairs.length())];
            }
            rewardTokens = distribution[i];
            if (rewardTokens > 0) {
                require(IPNG(png).transfer(stakeContract, rewardTokens), 'LiquidityPoolManager::distributeTokens: Transfer failed');
                StakingRewards(stakeContract).notifyRewardAmount(rewardTokens);
            }
        }
        unallocatedPng = 0;
    }

    /**
     * Fallback for distributeTokens in case of gas overflow. Distributes PNG tokens to a single pool.
     * distibuteTokens() must still be called once to reset the contract state before calling vestAllocation.
     *
     * Args:
     *   pairIndex: index of pair to distribute tokens to, AVAX pairs come first in the ordering
     */
    function distributeTokensSinglePool(uint pairIndex) external nonReentrant {
        require(readyToDistribute, 'LiquidityPoolManager::distributeTokensSinglePool: Previous returns not allocated. Call calculateReturns()');
        require(pairIndex < numPools, 'LiquidityPoolManager::distributeTokensSinglePool: Index out of bounds');

        address stakeContract;
        if (pairIndex < avaxPairs.length()) {
            stakeContract = stakes[avaxPairs.at(pairIndex)];
        } else {
            stakeContract = stakes[pngPairs.at(pairIndex - avaxPairs.length())];
        }

        uint rewardTokens = distribution[pairIndex];
        if (rewardTokens > 0) {
            distribution[pairIndex] = 0;
            require(IPNG(png).transfer(stakeContract, rewardTokens), 'LiquidityPoolManager::distributeTokens: Transfer failed');
            StakingRewards(stakeContract).notifyRewardAmount(rewardTokens);
        }
    }

    /**
     * Calculate pool token distribution and distribute tokens. Methods are separate
     * to use risk of approaching the gas limit. There must be vested tokens to
     * distribute, so this method should be called after vestAllocation.
     */
    function calculateAndDistribute() external {
        calculateReturns();
        distributeTokens();
    }

    /**
     * Claim today's vested tokens for the manager to distribute. Moves tokens from
     * the TreasuryVester to the LiquidityPoolManager. Can only be called if all
     * previously allocated tokens have been distributed. Call distributeTokens() if
     * that is not the case. If any additional PNG tokens have been transferred to this
     * this contract, they will be marked as unallocated and prepared for distribution.
     */
    function vestAllocation() external nonReentrant {
        require(unallocatedPng == 0, 'LiquidityPoolManager::vestAllocation: Old PNG is unallocated. Call distributeTokens().');
        unallocatedPng = ITreasuryVester(treasuryVester).claim();
        require(unallocatedPng > 0, 'LiquidityPoolManager::vestAllocation: No PNG to claim. Try again tomorrow.');

        // Check if we've received extra tokens or didn't receive enough
        uint actualBalance = IPNG(png).balanceOf(address(this));
        require(actualBalance >= unallocatedPng, "LiquidityPoolManager::vestAllocation: Insufficient PNG transferred");
        unallocatedPng = actualBalance;
    }

    /**
     * Calculate the equivalent of 1e18 of token A denominated in token B for a pair
     * with reserveA and reserveB reserves.
     *
     * Args:
     *   reserveA: reserves of token A
     *   reserveB: reserves of token B
     *
     * Returns: the amount of token B equivalent to 1e18 of token A
     */
    function quote(uint reserveA, uint reserveB) internal pure returns (uint amountB) {
        require(reserveA > 0 && reserveB > 0, 'PangolinLibrary: INSUFFICIENT_LIQUIDITY');
        uint oneToken = 1e18;
        amountB = SafeMath.div(SafeMath.mul(oneToken, reserveB), reserveA);
    }

}

interface ITreasuryVester {
    function claim() external returns (uint);
}

interface IPNG {
    function balanceOf(address account) external view returns (uint);
    function transfer(address dst, uint rawAmount) external returns (bool);
}

interface IPangolinPair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function factory() external view returns (address);
    function balanceOf(address owner) external view returns (uint);
    function transfer(address to, uint value) external returns (bool);
    function burn(address to) external returns (uint amount0, uint amount1);
    function getReserves() external view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast);
}

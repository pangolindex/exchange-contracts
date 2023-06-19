# Elixir

Elixir is modified UniswapV3 with the capability to have proper farms.

## Elixir Core

Following is the changes from UniswapV3 core.

* Arbitrary reward tracking is added to Pool
    * Added a RewardSlot storage slot to Pool, which has
        * `rewardPerSecondX48` (`uint144`)
        * `rewardRateEffectiveUntil` (`uint32`)
    * Added `rewardPerLiquidityCumulativeX64` (`uint194`) to Oracle.Observation
    * Added `rewardPerLiquidityOutsideX64` (`uint194`) to Tick.Info
    * Ensured swaps and liquidity operations all update these variables properly
    * Added `setRewardRate` function to arbitrarily change RewardSlot params
    * Pool.snapshotCumulativesInside has an extra return arg `rewardPerLiquidityInsideX64`
* Used minimal proxy to keep Factory size within the bytecode size limit
    * Immutable pool variables are not immutable anymore
    * Slight changes to Factory and pool creation
    * Factory constructor requires a proxy implementation address
    * Pool address derivation is kept the same
* Rebranded from UniswapV3 to Elixir
* Removed NoDelegatecall modifier

After cloning Uniswap core to `../uniswap/v3-core`, I suggest running the following commands to see the main differences.

```sh
git diff ../uniswap/v3-core/contracts/UniswapV3Factory.sol contracts/elixir-core/ElixirFactory.sol
git diff ../uniswap/v3-core/contracts/UniswapV3Pool.sol contracts/elixir-core/ElixirPool.sol
git diff ../uniswap/v3-core/contracts/libraries/Oracle.sol contracts/elixir-core/libraries/Oracle.sol
git diff ../uniswap/v3-core/contracts/libraries/Tick.sol contracts/elixir-core/libraries/Tick.sol
```

Although differences seem a lot, it is all additive, and should not effect behaviour of core functionality (except in some view functions).

I expect the main points of focus in a security work to be ensuring

* There isn't an operation left that should modify the added state variables but does not
* Added calculations in Oracle library are sound
* Added features did not introduce any DOS vectors to existing functionality

I am confident of 3rd point, because all existing tests for UniswapV3 were also run successfully on the modified codebase.

## Elixir Periphery

Following is the changes from UniswapV3 periphery.

* Added Reward recording
    * claimReward function to claim the rewards of a position
    * updateRewardManager to set rewardManager contract which is ElixirRewarder
    * forgoReward to renounce accumulated rewards
    * `_updateReward` in all position-modifying functions to track position rewards
* Made tokenDescriptor modifiable.
* Changed small things to keep the code within the bytecode size limit.
* Rebranded from UniswapV3 to Elixir
* Removed NoDelegatecall modifier

After cloning Uniswap periphery to `../uniswap/v3-periphery`, I suggest running the following commands to see the main differences.

```sh
git diff ../uniswap/v3-periphery/contracts/NonfungiblePositionManager.sol contracts/elixir-periphery/NonfungiblePositionManager.sol
git diff ../uniswap/v3-periphery/contracts/libraries/PoolAddress.sol contracts/elixir-periphery/libraries/PoolAddress.sol
git diff ../uniswap/v3-periphery/contracts/base/PeripheryValidation.sol contracts/elixir-periphery/base/PeripheryValidation.sol
```

## Elixir Rewarder

This is the contract where all those changes to UniswapV3 are leveraged. ElixirRewarder allows having 1 farm for 1 pool. A farm can have any token as a reward token. The reward token can be changed with a two weeks phase shift. Any unclaimed reward tokens at the end of two weeks can be clawed back by the owner. ElixirRewarder holds all the tokens that will be distributed as rewards. It sets the pool.rewardSlot by calling pool.setRewardRate, based on the reward added to it, not arbitrarily. ElixirRewarder does not keep track of which user is owed how much, that is tracked by NonfungiblePositionManager. It just trusts the value returned by NonfungiblePositionManager, which gets the values from Pool, and the Pool has its rewardSlot set by ElixirReward. So these systems tightly depend in each other. It is possible to swap these components, but it should be done very carefully.

### Known Issues

Reverse-JIT liquidity where bots frontrun swaps to exit from a pool before the swap and reenter after a swap. This allows bots to provide liquidity in a tight range and capture majority of the rewards without being a useful liquidity providers. We expect this strategy to be unfeasible for well-utilized pools.

## ElixirFactoryOwner

Contract that will own ElixirFactory. It has flexible access control to change who can call certain functions in ElixirFactory and NonfungiblePositionManager. It is not crazy flexible like how GMX handles access control, but it should still get the job done.

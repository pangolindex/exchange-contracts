# Pangolin Staking Positions

Pangolin Staking Positions is a unique staking solution. It utilizes the Sunshine and Rainbows
(SAR) algorithm, which distributes rewards as a function of balance and staking duration.

## Auditing Scope

These files are in scope:

* [`PangolinStakingPositions.sol`](./PangolinStakingPositions.sol)
* [`PangolinStakingPositionsFunding.sol`](./PangolinStakingPositionsFunding.sol)
* [`PangoChef.sol`](./PangoChef.sol)
* [`PangoChefFunding.sol`](./PangoChefFunding.sol)
* [`ReentrancyGuard.sol`](./ReentrancyGuard.sol)

These files are NOT in scope:

* [`StakingRewardsForwarder.sol`](./StakingRewardsForwarder.sol)
* [`TokenMetadata.sol`](./TokenMetadata.sol)
* [`GenericErrors.sol`](./GenericErrors.sol)

## Sunshine And Rainbows (🌞,🌈)

Sunshine and Rainbows is a novel staking algorithm. In SAR, rewards at a given interval are
distributed based on the below formula.

$\textit{reward proportion} = \frac{\textit{position staked balance}}{\textit{total staked balance}} \times \frac{\textit{position staking duration}}{\textit{average staking duration}}$

[SAR paper](./SunshineAndRainbows.pdf) describes how this formula is used to derive an algorithm
that can calculate rewards in *O(1)*.

## Staking Duration

Staking duration is the unique factor in SAR when determining the reward proportion of a position.
There are three basic rules for determining the staking duration of a staked token. Staking
duration (1) starts with staking, (2) restarts with harvesting, and (3) ends with withdrawing.

In core SAR, there are three important mutative user functions: `stake`, `harvest`,
 and `withdraw`. Depending on their effect to the staking duration, these functions can be
considered as destructive/devaluing ❗ or constructive ✅. The effects of calling these
function to the staking duration are described below.

* ✅ `stake(amount)`:
	* The existing staked balance of the position preserves its staking duration.
	* The staking duration of the newly staked tokens starts from zero.
* ❗ `harvest()`:
	* The staking duration for all the staked tokens of the position restarts.
  This is because `harvest` call claims all the accrued rewards of a position. It is not possible
  to claim only the rewards of a portion of one's staked balance. One can either claim it all
  or none. Note that one can have an implementation where this can be circumvented, but in all
  the implementations we wrote, partial harvesting is not possible, so we will go with this
  specification.
* ❗ `withdraw(amount)`:
	* The staking duration for all the staked balance of the position restarts.
  This is because when withdrawing, all the accrued rewards are harvested. So, even if not the
  whole balance is withdrawn, all the rewards are harvested, which in turn restarts the staking
  duration of any remaining balance.

## Implementations

In this repository, there are two implementations that utilize SAR algorithm.

### `PangolinStakingPositions`

[`PangolinStakingPositions`](./PangolinStakingPositions.sol) is a single-sided staking solution in
which both the staking and reward tokens are the same token (i.e.: PNG). The rewards comes from AMM
revenue. The revenue tokens get converted to PNG through `FeeCollector` (`SushiMaker` equivalent),
and then PNG is added to `PangolinStakingPositions` as reward. In this implementation of SAR, we also
track positions instead of users, which allows leveraging the NFT technology.

This implementation allows us to add an extra `compound` (✅) function to the core SAR functions. This
function makes no external calls because the reward and staking tokens are the same. Note that the
compounding function is not just for convenience, it is also a way to bypass calling `harvest()` (❗)
and restarting the staking duration.

* ✅ `compound()`:
	* Harvests and restakes the accrued rewards without restarting the staking duration,
	* The staking duration of the newly staked tokens starts from zero.

Since all positions are NFTs, this implementation opens the door for derivatives. This would allow
stakers to “leverage their loyalty”. Because a position which has double the staking duration than
average would also have twice the APR. This would render such a position more valuable than the
amount of PNG it holds.

However, due to lack of standardized slippage control for NFTs, mutable NFTs can be frontrun on
secondary marketplaces. To alleviate this issue we simply disable spending approvals for an NFT
for a short period following a destructive action (e.g.: `withdraw()`). This prevents secondary
marketplaces from executing `transferFrom()` function of NFTs to process the trade. So if a seller
tries to frontrun a buyer by withdrawing the staked balance from the NFT position, the transaction
will revert.

### `PangoChef`

[`PangoChef`](./PangoChef.sol) is a MiniChef analogue that uses SAR algorithm.

In this implementation, there can be infinite amount of pools which separetely utilize the SAR algorithm.
So each pool has its own total staked balance and average staking duration.

PangoChef distributes global rewards to pools based on Synthetix’s staking algorithm, such that pool operations
and updating rewards is in constant time as the number of pools increase. Then each pool separately utilizes
the SAR algorithm to distribute its reward allocation to users.

PangoChef requires a Uniswap V2 factory and a wrapped native token address to be defined in constructor. Although
PangoChef accepts any ERC20 token to be staked, it is mainly intended for liquidity pool tokens.

PangolinStakingPosition had a simple compounding mechanism. In PangoChef, compounding requires that (1) pool’s staking
token is a liquidity pool pair token of the factory defined in the constructor, and (2) one of the tokens in the pair
is `rewardsToken`. Given these requirements, compounding works as follows.

* ✅ `compound()`:
	* Harvests rewards without resetting the staking duration of the user of the pool,
  * Transfers equivalent amount of the pair of the rewards token from user’s wallet to the contract,
  * Pairs the rewards token and the token supplied by the user to create the staking token by adding liquidity to pair,
  * Stakes the newly minted liquidity pool receipt tokens to the pool,
	* The staking duration of the newly staked tokens starts from zero.

Another version of compounding is also possible for any pool. In this version, harvested rewards
from any pool are paired with wrapped version of the native gas token, and staked to pool zero. In
PangoChef, pool zero (`poolId == 0`) is reserved for `WRAPPED_NATIVE_TOKEN-REWARDS_TOKEN` liquidity
pool token, and it is created in constructor.

* ✅ `compoundToPoolZero()`:
	* Harvests rewards without resetting the staking duration of the user of the pool,
  * Transfers equivalent amount of native gas token from user’s wallet to the contract,
  * Pairs the rewards token and the wrapped version of the native gas token to create the staking token of pool zero,
  * Stakes the newly minted liquidity pool receipt tokens to the pool zero,
	* The staking duration of the newly staked tokens starts from zero,
  * A lock is created on pool zero.

Compounding to pool zero requires a locking mechanism to prevent gaming of the system. Without locking, a user could
compound to pool zero, then withdraw their principal from pool zero right away. This means that rewards of a pool is
harvested and transferred to user’s wallet without the staking duration getting reset. This defeats the purpose of SAR.
Locking works in the following manner to prevent this issues.

When pool A rewards are compounded to pool zero, the user’s lock count on pool zero is
incremented by one, only if pool A did not already have a lock on pool zero. When user harvests or
withdraws from pool A, the user’s lock count on pool zero is decremented by one, only if pool A
was locking it. For a user to harvest or withdraw from pool zero, the user’s lock count on pool
zero should be zero. If a user compounds to rewards of pool A, B, and C to pool zero, the user’s
lock count will be three. The user will only be able to withdraw or harvest from pool zero after
they withdraw or harvest at least once from all of those three pools. This mechanism ensures the principle of
**rewards of a pool must not leave the contract without the pool’s staking duration getting reset**.
Violation of this prinicple would be a critical vulnerability. Another major bug would be the lock count
getting stuck at non-zero without a way to bring it back to zero again.

Another feature of PangoChef is rewarder. Rewarder is an external contract that can be defined
for any pool. Rewarder allows distributing extra token rewards. One issue with Rewarder is that
it can allow a malicious owner to create DOS on withdraw functions. To prevent this, usually
there is an emergency exit function that lacks the rewarder hook. We did not want to have an exit
function lacking the rewarder hook, because that prohibits time-based rewarders (as opposed to
multiplier-based rewarders). By exiting without a hook, users can trick rewarder that they are
still staking, hence they can accrue rewards that they do not deserve. As a solution both to the
DOS on exit by rewarder, and user’s gaming a time-based rewarder, we decided to add a low-level
call to rewarder in emergency exit. Low-level calls do not cause revert if the external contract
call reverts. So that should solve both the issues.

Yet another feature of PangoChef is relayer pools. That is an alternative type of pool to ERC20 pools,
and its only purpose of the pool is to divert its share of rewards to a single address. This can
allow us to divert emissions to partners, or have a separate contract that manages ERC721 staking.

## Notes on Code Style

We are aware that solc do not check for truncation when type casting. The code is deliberately
written such that either by input sanitization, or by basic assumptions about current timestamp,
there should be no truncation. The same reasoning goes for the use of unchecked blocks.

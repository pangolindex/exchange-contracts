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

Features:
* Compounding WAVAX-PNG pool by supplying AVAX
* Staking to WAVAX-PNG by supplying WAVAX and rewards from other pools
* Rewarder support

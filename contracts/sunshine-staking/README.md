# Sunshine And Rainbows (🌞,🌈)

Sunshine and Rainbows (SAR) is a novel staking algorithm. SAR contracts utilize
not only a novel algorithm, but also introduce multiple new concepts both in
tokenomics and staking architecture.

## Core Algorithm

Most DeFi staking algorithms are derived from [Synthetix’ implementation](https://github.com/Synthetixio/synthetix/blob/v2.54.0/contracts/StakingRewards.sol).
This implementation simply distributes rewards, *r*, proportional to user’s
staked amount, *y*, to the total staked amount, *Σy*. So, for each interval, a
user’s (position’s) reward, *P*, is defined as follows.

![Simple Staking](https://latex.codecogs.com/svg.latex?P%3D%5Cfrac%7By%7D%7B%5Csum%7By%7D%7Dr )

To encourage long-term staking and reduce sell pressure on the reward token,
SAR adds staking duration, *x*, to the equation above.

![SAR Staking](https://latex.codecogs.com/svg.latex?P%3D%5Cfrac%7Bxy%7D%7B%5Csum%7Bxy%7D%7Dr )

This basic equation is then used to invent a new formula to calculate
rewards in *O(1)*. **Refer to [the proofs](https://gateway.pinata.cloud/ipfs/Qmat8gcrWjbFqDK5Aw3X8c29q1DQpNJR3T6wpbRoY3AfHA)** for the derivation and symbols
used in the equation below.

![SAR Staking Final](https://latex.codecogs.com/svg.latex?P_%7Bn%5Crightarrow%20m%7D%3D%5Cleft%28%5Csum_%7Bi%3Dn%7D%5E%7Bm%7D%7BI_i%7D-%5Cleft%28%5Csum_%7Bi%3Dn%7D%5E%7Bm%7D%7B%5Cfrac%7Br_i%7D%7BS_i%7D%7D%5Cright%29%5Csum_%7Bi%3D1%7D%5E%7Bn-1%7D%7Bt_i%7D%5Cright%29y )

## Position-Based Account Tracking

Staking duration resets on withdraw, deposit, or harvest functions. However,
depositing is a positive event for a farm’s health. Therefore, it should not be
discouraged by resetting the staking duration of an existing user. To prevent
this, staking duration, balance, and rewards are tracked as positions instead
of users. This way, a user can have infinite positions which hold different
balances at different staking durations. In the reference implementation,
`SunshineAndRainbows.sol`, the stake function opens a new position for the user
instead of resetting an existing position.

## Locked-Deposit Harvesting

Harvesting can be a desirable or an undesirable event for a farm’s health.
If a user sells the rewards, that would be undesirable. If a user adds more
liquidity with the rewards, that would be desirable. However, there is no
way to know beforehand how a user will spend those rewards. Therefore, the
staking duration for the position is reset to zero whenever the rewards are
harvested. As an alternative, we introduce *locked-deposit harvesting*. In this
method, staking duration of a position does not reset, because the rewards
never leave the contract. Instead of the rewards being transferred to the user,
they are used to create a new position. The new position is considered the
child of the position from which the rewards are harvested. When a position has
a parent, its deposit cannot be withdrawn until the parent position’s staking
duration is reset at least once after the creation of the child position.
*Locked-deposit harvesting* is only possible when the staking token is the same
as the reward token, or when the staking token can be derived from the reward
token (i.e.: liquidity pool tokens). `SunshineAndRainbowsCompound.sol` features
the reference implementation of *loked-deposit harvesting* when the reward
token is the same as staking token.

## Reward Regulator

For modularity, how the total reward rate is determined, and how
the rewards are distributed are defined in separate contracts.
`RewardRegulatorFundable.sol` handles the former. Refer to the in-code
documentation for the specifications of how this is managed.

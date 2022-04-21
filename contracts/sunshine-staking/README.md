# Sunshine And Rainbows (🌞,🌈)

Sunshine and Rainbows (SAR) is a novel staking algorithm.

## Reward Distribution

Most DeFi staking algorithms are derived from [Synthetix’ implementation](https://github.com/Synthetixio/synthetix/blob/v2.54.0/contracts/StakingRewards.sol).
This implementation simply distributes rewards based on the proportion of user’s
staked amount to the total staked amount.

![Simple Staking](https://latex.codecogs.com/svg.image?\textit{reward&space;proportio}n&space;=&space;\frac{\textit{user&space;stake&space;balance}}{\textit{total&space;staked}})

To encourage long-term staking and reduce sell pressure on the reward token,
SAR adds staking duration to that equation.

![SAR Staking](https://latex.codecogs.com/svg.image?\textit{reward&space;proportio}n&space;=&space;\frac{\textit{user&space;stake&space;balance}}{\textit{total&space;staked}}&space;\times&space;\frac{\textit{user&space;staking&space;duration}}{\textit{average&space;staking&space;duration}})

This basic rule is then used to invent a new formula to calculate
rewards in constant time. It is **essential to refer to [the proofs](https://gateway.pinata.cloud/ipfs/Qmat8gcrWjbFqDK5Aw3X8c29q1DQpNJR3T6wpbRoY3AfHA)**
for making sense of the formulas used in the contracts.

## Staking Duration

Staking duration is the unique factor in SAR when determining the reward
proportion of a user. There are three basic rules for determining the
staking duration of a staked token. Staking duration (1) starts with staking,
(2) restarts with harvesting, and (3) ends with withdrawing.

In core SAR implementation, there are three mutative external functions:
`stake`, `harvest`, and `withdraw`. The effect of calling these function to the
staking duration is as follows:

* `stake(amount)`: The staking duration of the newly staked tokens will start
from zero. However, the existing staked balance of the user will preserve its
staking duration.
* `harvest()`: The staking duration for all the staked tokens of the user
will reset to zero. This is because `harvest` call will claim all the accrued
rewards of a user. It is not possible to claim only the rewards of a portion
of one's staked balance. One can either claim it all or none.
* `withdraw(amount)`: The staking duration for all the staked balance of the
user will reset to zero. This is because when withdrawing, all the accrued
rewards are harvested. So, even if not the whole balance is withdrawn, all
the rewards will be harvested, which will reset the staking duration of any
remaining balance to zero.

To enable partial harvesting, which would in turn enable partial withdrawing
without resetting the staking duration of the whole staked balance, one can
track staking duration of positions instead of users. This model would allow
users to have unlimited positions with varying staking duration. Due to
user-facing complexitiy of this model, we opt out from using it.

## Compounding

Compounding is provided as an extension to the core SAR contract.
Compounding allows harvesting without resetting the staking duration, which
technically violates the second rule of the staking duration. However, this
is not an issue, because when compounding, harvested rewards do not leave
the contract. The only way to remove those tokens from the contract after
compounding would be to withdraw. Since withdrawing resets the staking
duration of all the staked balance, there is no need to reset the staking
duration when compounding.

For compounding to work, the staking token should be deriverable from the
reward token. This is possible if the staking token is the reward token or the
staking tokens is a pool token in which the reward token is a pair token.


## Reward Regulator

For modularity, how the global reward rate is determined, and how the rewards
are distributed are defined in separate contracts. Reward Regulator (RR)
handles the former, and SAR handles the latter. In this architecture, RR holds
the reward token, and SAR contract calls the `claim` function of RR whenever
someone stakes, withdraws, or harvests. SAR then handles the distributes
of the claimed amount to stakers. This becomes a much more flexible way of
handling reward distribution as opposed to something monolithic like MiniChef
or MasterChef.

## SAR Token

SAR contract can be inherited by a non-transferrable token contract. The stakers
would own this non-transferrable token as a factor of their staked balance and
staking duration. This opens the gates of a governance scheme similar to “ve”
model.

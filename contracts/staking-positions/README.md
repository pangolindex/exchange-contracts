# Pangolin Staking Positions

Pangolin Staking Positions is a unique staking solution. It utilizes the Sunshine and Rainbows
(SAR) algorithm, which distributes rewards as a function of balance and staking duration. In this
implementation SAR, we track positions instead of users, which allows leveraging NFT technology.

## Sunshine And Rainbows (🌞,🌈)

Sunshine and Rainbows is a novel staking algorithm. In SAR, rewards at a given interval are
distributed based on the below formula.

![SAR](https://latex.codecogs.com/svg.image?\textit{reward&space;proportio}n&space;=&space;\frac{\textit{position&space;staked&space;balance}}{\textit{total&space;staked&space;balance}}&space;\times&space;\frac{\textit{position&space;staking&space;duration}}{\textit{average&space;staking&space;duration}} )

[SAR paper](https://gateway.pinata.cloud/ipfs/QmbvtoPtooSjTNfToAkRzjArvCWwGQDHk3kGeHYuSguCar)
describes how this formula is used to derive an algorithm that can calculate rewards in *O(1)*.

## Staking Duration

Staking duration is the unique factor in SAR when determining the reward proportion of a position.
There are three basic rules for determining the staking duration of a staked token. Staking
duration (1) starts with staking, (2) restarts with harvesting, and (3) ends with withdrawing.

In our SAR implementation, there are four important mutative user functions: `stake`, `harvest`,
`compound`, and `withdraw`. The effects of calling these function to the staking duration are
described below.

* `stake(amount)`:
	* The existing staked balance of the position preserves its staking duration.
	* The staking duration of the newly staked tokens starts from zero.
* `harvest()`:
	* The staking duration for all the staked tokens of the position restarts.
  This is because `harvest` call claims all the accrued rewards of a position. It is not possible
  to claim only the rewards of a portion of one's staked balance. One can either claim it all or
  none.
* `withdraw(amount)`:
	* The staking duration for all the staked balance of the position restarts.
  This is because when withdrawing, all the accrued rewards are harvested. So, even if not the
  whole balance is withdrawn, all the rewards are be harvested, which will restarts the staking
  duration of any remaining balance.
* `compound`:
  * Harvests and restakes the accrued rewards without restarting the staking duration,
	* The staking duration of the newly staked tokens starts from zero.

To enable partial harvesting, which would in turn enable partial withdrawing without restarting
the staking duration of the whole staked balance, one can track staking duration of positions
instead of users. This model would allow users to have unlimited positions with varying staking
duration. Due to user-facing complexitiy of this model, we opt out from using it. We instead use
the "Combined Positions" extension of SAR, which prohibits partial harvesting.

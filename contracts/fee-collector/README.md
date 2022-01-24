# Pangolin Fee Controller


Contract to which fees taken from the pools and paid out in PGL are redirected.
The contract swaps the fees to PNG and uses them to fund the staking rewards for PNG.
If additional rewards are available from emissions they can likewise be harvested and redirected to the staking rewards contract.

## Specifications

![image](https://user-images.githubusercontent.com/25791237/145143553-371e6893-43d4-44e8-9c4d-788ad6999139.png)


## Requirements

- Python 3+
- brownie-eth

## Tests

run `brownie test`

## Deployment

Create a local account using the <a href="https://eth-brownie.readthedocs.io/en/stable/account-management.html#local-accounts">brownie command line</a> using the id `avalanche-deploy` (or rename the wallet id in the script).

Then run:

`brownie run scripts/deploy.py`

To run a test deployment on Fuji:


`brownie run scripts/deploy.py --network avax-test`

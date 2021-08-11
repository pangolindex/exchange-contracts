# Pangolin Smart Contracts
This repo contains all of the smart contracts used to run [Pangolin](pangolin.exchange).

## Deployed Contracts
Factory address: `0xefa94DE7a4656D787667C749f7E1223D71E9FD88`

Router address: `0xE54Ca86531e17Ef3616d22Ca28b0D458b6C89106`

Migrator address: `0x4b23Aa72A1214d0E4fd3f2c8Da7C6ba660F7483C`

## Running
These contracts are compiled and deployed using [Hardhat](https://hardhat.org/). They can also be run using the Remix IDE. A tutorial for using Remix is located [here](https://docs.avax.network/build/tutorials/platform/deploy-a-smart-contract-on-avalanche-using-remix-and-metamask).

To prepare the dev environment, run `yarn install`. To compile the contracts, run `yarn compile`. Yarn is available to install [here](https://classic.yarnpkg.com/en/docs/install/#debian-stable) if you need it.

## Accessing the ABI
If you need to use any of the contract ABIs, you can install this repo as an npm package with `npm install --dev @pangolindex/exchange-contracts`. Then import the ABI like so: `import { abi as IPangolinPairABI } from '@pangolindex/exchange-contracts/artifacts/contracts/pangolin-core/interfaces/IPangolinPair.sol/IPangolinPair.json'`.

## Attribution
These contracts were adapted from these Uniswap repos: [uniswap-v2-core](https://github.com/Uniswap/uniswap-v2-core), [uniswap-v2-periphery](https://github.com/Uniswap/uniswap-v2-core), and [uniswap-lib](https://github.com/Uniswap/uniswap-lib).

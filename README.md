# Pangolin Smart Contracts
This repo contains all of the smart contracts used to run [Pangolin](pangolin.exchange).

## Running
These contracts are compiled and deployed using [Hardhat](https://hardhat.org/). They can also be run using the Remix IDE. A tutorial for using Remix is located [here](https://docs.avax.network/build/tutorials/platform/deploy-a-smart-contract-on-avalanche-using-remix-and-metamask).

To prepare the dev environment, run `yarn install`. To compile the contracts, run `yarn compile`. Yarn is available to install [here](https://classic.yarnpkg.com/en/docs/install/#debian-stable) if you need it.

## Accessing the ABI
If you need to use any of the contract ABIs, you can install this repo as an npm package with `npm install --dev @pangolindex/exchange-contracts`. Then import the ABI like so: `import { abi as IPangolinPairABI } from '@pangolindex/exchange-contracts/artifacts/contracts/pangolin-core/interfaces/IPangolinPair.sol/IPangolinPair.json'`.

## Attribution
These contracts were adapted from these Uniswap repos: [uniswap-v2-core](https://github.com/Uniswap/uniswap-v2-core), [uniswap-v2-periphery](https://github.com/Uniswap/uniswap-v2-core), and [uniswap-lib](https://github.com/Uniswap/uniswap-lib).

# Contracts
To deploy to any chain you want, you need to complete the following steps:
- [ ] Update `hardhat.config.js` Chain with your private key
- [ ] Create a new configuration under `constants/**chainname**_testnet.js`
- [ ] Run the following command
```bash
npx hardhat --network **chainname**_mainnet run scripts/deploy-mainnet.js 
```

## Aurora
Currently on Aurora you need to get funds into Goerli and then bridge across. You can do this by following these steps:
- Get some ETH from Chainlink Faucet https://faucets.chain.link/goerli
- Send ETH to Aurora via Rainbow Bridge https://testnet.rainbowbridge.app/

## BSC
Faucet: https://testnet.binance.org/faucet-smart
## Cronos
Testnet faucet can be found here https://cronos.crypto.org/faucet

## Harmony
To get Harmony tokens on the testnet please go here https://faucet.pops.one/. **Please note** the Metamask address is different to your Harmony address, so you'll need to go to the Explorer to convert https://explorer.pops.one/
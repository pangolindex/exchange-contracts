require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-etherscan");
const { CHAINS } = require("@pangolindex/sdk");
require('dotenv').config();

// Create hardhat networks from @pangolindex/sdk
let networksFromSdk = {};
for(let i = 0; i < CHAINS.length; i++) {
  networksFromSdk[CHAINS[i].id] = {
    url: CHAINS[i].rpc_uri,
    chainId: CHAINS[i].chain_id,
    accounts: [process.env.PRIVATE_KEY]
  };
};
networksFromSdk["hardhat"] = {
  chainId: 43112,
  initialDate: "2021-10-10",
}

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async () => {
  const accounts = await ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.4.16"
      },
      {
        version: "0.5.16"
      },
      {
        version: "0.6.2"
      },
      {
        version: "0.6.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      },
      {
        version: "0.6.12"
      },
      {
        version: "0.7.0"
      },
      {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      },
      {
        version: "0.8.9"
      }
    ],
    overrides: {
      "contracts/mini-chef-zapper/MiniChefV2Zapper.sol": {
        version: "0.8.11"
      }
    }
  },
  networks: networksFromSdk,
  etherscan: {
    apiKey: {
        mainnet: process.env.ETHERSCAN_API_KEY,
        ropsten: process.env.ETHERSCAN_API_KEY,
        rinkeby: process.env.ETHERSCAN_API_KEY,
        goerli: process.env.ETHERSCAN_API_KEY,
        kovan: process.env.ETHERSCAN_API_KEY,
        // binance smart chain
        bsc: process.env.BSCSCAN_API_KEY,
        bscTestnet: process.env.BSCSCAN_API_KEY,
        // huobi eco chain
        heco: process.env.HECOINFO_API_KEY,
        hecoTestnet: process.env.HECOINFO_API_KEY,
        // fantom mainnet
        opera: process.env.FTMSCAN_API_KEY,
        ftmTestnet: process.env.FTMSCAN_API_KEY,
        // optimism
        optimisticEthereum: process.env.OPTIMISTIC_ETHERSCAN_API_KEY,
        optimisticKovan: process.env.OPTIMISTIC_ETHERSCAN_API_KEY,
        // polygon
        polygon: process.env.POLYGONSCAN_API_KEY,
        polygonMumbai: process.env.POLYGONSCAN_API_KEY,
        // arbitrum
        arbitrumOne: process.env.ARBISCAN_API_KEY,
        arbitrumTestnet: process.env.ARBISCAN_API_KEY,
        // avalanche
        avalanche: process.env.SNOWTRACE_API_KEY,
        avalancheFujiTestnet: process.env.SNOWTRACE_API_KEY,
        // moonbeam
        moonriver: process.env.MOONRIVER_MOONSCAN_API_KEY,
        moonbaseAlpha: process.env.MOONBEAM_MOONSCAN_API_KEY,
        // xdai and sokol don't need an API key, but you still need
        // to specify one; any string placeholder will work
        xdai: "api-key",
        sokol: "api-key",
    }
  }
};

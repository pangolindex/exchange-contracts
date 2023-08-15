import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "hardhat-contract-sizer";
import "hardhat-typechain";
import "hardhat-watcher";

import { CHAINS } from "@pangolindex/sdk";
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const CUSTOM_OPTIMIZER_COMPILER_SETTINGS = {
  version: "0.7.6",
  settings: {
    optimizer: {
      enabled: true,
      runs: 20,
    },
  },
};

const LOW_OPTIMIZER_COMPILER_SETTINGS = {
  version: "0.7.6",
  settings: {
    evmVersion: "istanbul",
    optimizer: {
      enabled: true,
      runs: 2_000,
    },
    metadata: {
      bytecodeHash: "none",
    },
  },
};

const LOWEST_OPTIMIZER_COMPILER_SETTINGS = {
  version: "0.7.6",
  settings: {
    evmVersion: "istanbul",
    optimizer: {
      enabled: true,
      runs: 1_000,
    },
    metadata: {
      bytecodeHash: "none",
    },
  },
};

// Create hardhat networks from @pangolindex/sdk
let networksFromSdk: any = {};
for (const chain of Object.values(CHAINS)) {
  networksFromSdk[chain.id] = {
    url: chain.rpc_uri,
    chainId: chain.chain_id,
    accounts: [process.env.PRIVATE_KEY],
  };
}
networksFromSdk["hardhat"] = {
  chainId: 43112,
  initialDate: "2021-10-10",
};

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.4.16",
      },
      {
        version: "0.5.16",
      },
      {
        version: "0.6.2",
      },
      {
        version: "0.6.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
        },
      },
      {
        version: "0.6.12",
      },
      {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 800,
          },
        },
      },
      {
        version: "0.8.9",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
        },
      },
      {
        version: "0.8.13",
        settings: {
          optimizer: {
            enabled: true,
            runs: 2000,
          },
        },
      },
      {
        version: "0.8.15",
        settings: {
          optimizer: {
            enabled: true,
            runs: 2000,
          },
        },
      },
      {
        version: "0.8.19",
        settings: {
          optimizer: {
            enabled: true,
            runs: 2000,
          },
        },
      },
    ],
    overrides: {
      "contracts/mini-chef-zapper/MiniChefV2Zapper.sol": {
        version: "0.8.11",
      },
      "contracts/pangolin-core/test/ERC20.sol": {
        version: "0.5.16",
        settings: {
          // For mocking
          outputSelection: {
            "*": {
              "*": ["storageLayout"],
            },
          },
        },
      },
      "contracts/WAVAX.sol": {
        version: "0.5.17",
        settings: {
          // For mocking
          outputSelection: {
            "*": {
              "*": ["storageLayout"],
            },
          },
        },
      },
      "contracts/elixir-periphery/NonfungiblePositionManager.sol":
        CUSTOM_OPTIMIZER_COMPILER_SETTINGS,
      "contracts/elixir-periphery/test/MockTimeNonfungiblePositionManager.sol":
        CUSTOM_OPTIMIZER_COMPILER_SETTINGS,
      "contracts/elixir-periphery/test/NFTDescriptorTest.sol":
        LOWEST_OPTIMIZER_COMPILER_SETTINGS,
      "contracts/elixir-periphery/NonfungibleTokenPositionDescriptor.sol":
        LOWEST_OPTIMIZER_COMPILER_SETTINGS,
      "contracts/elixir-periphery/libraries/NFTDescriptor.sol":
        LOWEST_OPTIMIZER_COMPILER_SETTINGS,
    },
  },
  watcher: {
    test: {
      tasks: [{ command: "test", params: { testFiles: ["{path}"] } }],
      files: ["./test/**/*"],
      verbose: true,
    },
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
      // optimisticKovan: process.env.OPTIMISTIC_ETHERSCAN_API_KEY, // to avoid the error
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
      flare: "api-key",
      coston2: "api-key",
    },
    // adding support for non-supported explorers
    // see Hardhat Docs for additional information
    // https://hardhat.org/hardhat-runner/plugins/nomiclabs-hardhat-etherscan#adding-support-for-other-networks
    customChains: [
      {
        network: "flare",
        chainId: 14,
        urls: {
          apiURL: "https://flare-explorer.flare.network/api",
          browserURL: "https://flare-explorer.flare.network/",
        },
      },
      {
        network: "coston2",
        chainId: 114,
        urls: {
          apiURL: "https://coston2-explorer.flare.network/api",
          browserURL: "https://coston2-explorer.flare.network/",
        },
      },
    ],
  },
};

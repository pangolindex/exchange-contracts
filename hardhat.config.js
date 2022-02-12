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
        version: "0.8.0"
      },
      {
        version: "0.8.9"
      },
      {
        version: "0.8.11"
      }
    ]
  },
  networks: networksFromSdk,
  etherscan: {
    apiKey: {
        avalanche: [process.env.SNOWTRACE_API_KEY],
        avalancheFujiTestnet: [process.env.SNOWTRACE_API_KEY],
    }
  }
};

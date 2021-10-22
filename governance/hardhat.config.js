require("@nomiclabs/hardhat-waffle");
//require("@tenderly/hardhat-tenderly");
require("solidity-coverage");

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
        version: "0.5.16"
      },
      {
        version: "0.6.4"
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
        version: "0.6.11"
      },
      {
        version: "0.6.12"
      },
      {
        version: "0.7.4"
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
        version: "0.8.0",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      }
    ],
    overrides: {
      "contracts/Airdrop.sol": {
        version: "0.8.0",
        settings: { }
      }
    }
  },
  networks: {
    hardhat: {
      gasPrice: 225000000000,
      chainId: 43114,
      initialDate: "2021-01-01" // Used for tests
    },
    local: {
      url: 'http://127.0.0.1:8545',
      gasPrice: 225000000000,
      chainId: 43114,
      // accounts: [""]
    },
    fuji: {
      url: 'https://api.avax-test.network/ext/bc/C/rpc',
      gasPrice: 225000000000
    },
    mainnet: {
      url: 'https://api.avax.network/ext/bc/C/rpc',
      gasPrice: 225000000000
    }
  }
};

require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-ethers");

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
      }
    ]
  },
  networks: {
    hardhat: {
      gasPrice: 470000000000,
      chainId: 43112,
      initialDate: "2020-10-10",
    },
    ethereum: {
      url: 'https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
      gasPrice: 470000000000,
      chainId: 1,
      accounts: ["0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027"]
    },
    avash: {
      url: 'http://localhost:9650/ext/bc/C/rpc',
      gasPrice: 470000000000,
      chainId: 43112,
      accounts: ["0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027"]
    },
    fuji: {
      url: 'https://api.avax-test.network/ext/bc/C/rpc',
      gasPrice: 470000000000,
      chainId: 43113,
      accounts: []
    },
    arbitrum_mainnet: {
      url: 'https://arb1.arbitrum.io/rpc',
      gasPrice: 470000000000,
      chainId: 42161,
      accounts: []
    },
    aurora_mainnet: {
      url: 'https://mainnet.aurora.dev',
      gasPrice: 470000000000,
      chainId: 1313161554,
      accounts: []
    },
    aurora_testnet: {
      url: 'https://testnet.aurora.dev/',
      gasPrice: 4700000000,
      chainId: 1313161555,
      accounts: []
    },
    avalanche_mainnet: {
      url: 'https://api.avax.network/ext/bc/C/rpc',
      gasPrice: 470000000000,
      chainId: 43114,
      accounts: []
    },
    bsc_mainnet: {
      url: 'https://bsc-dataseed.binance.org/',
      gasPrice: 470000000000,
      chainId: 56,
      accounts: []
    },
    bsc_testnet: {
      url: 'https://data-seed-prebsc-1-s1.binance.org:8545/',
      gasPrice: 470000000000,
      chainId: 97,
      accounts: []
    },
    cronos_mainnet: {
      url: 'https://evm-cronos.crypto.org/',
      gasPrice: 470000000000,
      chainId: 25,
      accounts: []
    },
    fantom_mainnet: {
      url: 'https://rpc.ftm.tools/',
      gasPrice: 470000000000,
      chainId: 250,
      accounts: []
    },
    fantom_testnet: {
      url: 'https://rpc.testnet.fantom.network/',
      gasPrice: 470000000000,
      chainId: 0xfa2,
      accounts: []
    },
    fuse_mainnet: {
      url: 'https://rpc.fuse.io ',
      gasPrice: 470000000000,
      chainId: 0x7a,
      accounts: []
    },
    harmony_mainnet: {
      url: 'https://api.harmony.one',
      gasPrice: 470000000000,
      chainId: 1666600000,
      accounts: []
    },
    heco_mainnet: {
      url: 'https://http-mainnet.hecochain.com',
      gasPrice: 470000000000,
      chainId: 128,
      accounts: []
    },
    klaytn_mainnet: {
      url: '	https://kaikas.cypress.klaytn.net:8651',
      gasPrice: 470000000000,
      chainId: 8217,
      accounts: []
    },
    moonriver_mainnet: {
      url: 'https://rpc.moonriver.moonbeam.network',
      gasPrice: 470000000000,
      chainId: 1285,
      accounts: []
    },
    moonbeam_mainnet: {
      url: 'https://rpc.api.moonbeam.network',
      gasPrice: 470000000000,
      chainId: 1284,
      accounts: []
    },
    okex_mainnet: {
      url: 'https://exchainrpc.okex.org',
      gasPrice: 470000000000,
      chainId: 66,
      accounts: []
    },
    poa_mainnet: {
      url: 'https://core.poanetwork.dev',
      gasPrice: 470000000000,
      chainId: 99,
      accounts: []
    },
    polygon_mainnet: {
      url: 'https://polygon-rpc.com/ ',
      gasPrice: 470000000000,
      chainId: 137,
      accounts: []
    },
    polygon_testnet: {
      url: 'https://rpc-mumbai.maticvigil.com/',
      gasPrice: 470000000000,
      chainId: 80001,
      accounts: []
    },
    xdai_mainnet: {
      url: 'https://rpc.xdaichain.com/',
      gasPrice: 470000000000,
      chainId: 100,
      accounts: []
    }
  }
};

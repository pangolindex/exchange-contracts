require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-ethers");
require('dotenv').config();

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
      chainId: 43112,
      initialDate: "2020-10-10",
    },
    ethereum: {
      url: 'https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
      chainId: 1,
      accounts: ["0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027"]
    },
    avash: {
      url: 'http://localhost:9650/ext/bc/C/rpc',
      chainId: 43112,
      accounts: ["0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027"]
    },
    fuji: {
      url: 'https://api.avax-test.network/ext/bc/C/rpc',
      chainId: 43113,
      accounts: [process.env.PRIVATE_KEY]
    },
    arbitrum_mainnet: {
      url: 'https://arb1.arbitrum.io/rpc',
      chainId: 42161,
      accounts: [process.env.PRIVATE_KEY]
    },
    abritrum_testnet: {
      url: 'https://rinkeby.arbitrum.io/rpc',
      chainId: 421611,
      accounts: [process.env.PRIVATE_KEY]
    },
    aurora_mainnet: {
      url: 'https://mainnet.aurora.dev',
      chainId: 1313161554,
      accounts: [process.env.PRIVATE_KEY]
    },
    aurora_testnet: {
      url: 'https://testnet.aurora.dev/',
      chainId: 1313161555,
      accounts: [process.env.PRIVATE_KEY]
    },
    avalanche_mainnet: {
      url: 'https://api.avax.network/ext/bc/C/rpc',
      chainId: 43114,
      accounts: [process.env.PRIVATE_KEY]
    },
    bsc_mainnet: {
      url: 'https://bsc-dataseed.binance.org/',
      chainId: 56,
      accounts: [process.env.PRIVATE_KEY]
    },
    bsc_testnet: {
      url: 'https://data-seed-prebsc-1-s1.binance.org:8545/',
      chainId: 97,
      accounts: [process.env.PRIVATE_KEY]
    },
    cronos_mainnet: {
      url: 'https://evm-cronos.crypto.org/',
      chainId: 25,
      accounts: [process.env.PRIVATE_KEY]
    },
    cronos_testnet: {
      url: 'https://cronos-testnet-3.crypto.org:8545/',
      chainId: 338,
      accounts: [process.env.PRIVATE_KEY]
    },
    fantom_mainnet: {
      url: 'https://rpc.ftm.tools/',
      chainId: 250,
      accounts: [process.env.PRIVATE_KEY]
    },
    fantom_testnet: {
      url: 'https://rpc.testnet.fantom.network/',
      chainId: 0xfa2,
      accounts: [process.env.PRIVATE_KEY]
    },
    fuse_mainnet: {
      url: 'https://rpc.fuse.io ',
      chainId: 0x7a,
      accounts: [process.env.PRIVATE_KEY]
    },
    harmony_mainnet: {
      url: 'https://api.harmony.one',
      chainId: 1666600000,
      accounts: [process.env.PRIVATE_KEY]
    },
    harmony_testnet: {
      url: 'https://api.s0.b.hmny.io',
      chainId: 1666700000,
      accounts: [process.env.PRIVATE_KEY]
    },
    heco_mainnet: {
      url: 'https://http-mainnet.hecochain.com',
      chainId: 128,
      accounts: [process.env.PRIVATE_KEY]
    },
    klaytn_mainnet: {
      url: '	https://kaikas.cypress.klaytn.net:8651',
      chainId: 8217,
      accounts: [process.env.PRIVATE_KEY]
    },
    moonriver_mainnet: {
      url: 'https://rpc.moonriver.moonbeam.network',
      chainId: 1285,
      accounts: [process.env.PRIVATE_KEY]
    },
    moonbeam_mainnet: {
      url: 'https://rpc.api.moonbeam.network',
      chainId: 1284,
      accounts: [process.env.PRIVATE_KEY]
    },
    moonbase_testnet: {
      url: 'https://rpc.api.moonbase.moonbeam.network',
      chainId: 1287,
      accounts: [process.env.PRIVATE_KEY]
    },
    okex_mainnet: {
      url: 'https://exchainrpc.okex.org',
      chainId: 66,
      accounts: [process.env.PRIVATE_KEY]
    },
    poa_mainnet: {
      url: 'https://core.poanetwork.dev',
      chainId: 99,
      accounts: [process.env.PRIVATE_KEY]
    },
    polygon_mainnet: {
      url: 'https://polygon-rpc.com/ ',
      chainId: 137,
      accounts: [process.env.PRIVATE_KEY]
    },
    polygon_testnet: {
      url: 'https://rpc-mumbai.maticvigil.com/',
      chainId: 80001,
      accounts: [process.env.PRIVATE_KEY]
    },
    wagmi_mainnet: {
      url: 'https://api.trywagmi.xyz/rpc',
      chainId: 11111,
      accounts: [process.env.PRIVATE_KEY]
    },
    xdai_mainnet: {
      url: 'https://rpc.xdaichain.com/',
      chainId: 100,
      accounts: [process.env.PRIVATE_KEY]
    }
  }
};

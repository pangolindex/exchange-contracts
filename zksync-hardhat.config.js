require("@matterlabs/hardhat-zksync-deploy");
require("@matterlabs/hardhat-zksync-solc");
require("@matterlabs/hardhat-zksync-verify");
require("dotenv").config();

var exports = require('./hardhat.config.js');
const soliditySettings = exports.solidity;

const { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } = require("hardhat/builtin-tasks/task-names");
const path = require("path");

const ignoreList = [
  "MiniChefV2Zapper.sol",
]

subtask(
  TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS,
  async (_, { config }, runSuper) => {
    const paths = await runSuper();

    return paths
      .filter(solidityFilePath => {
        const relativePath = path.relative(config.paths.sources, solidityFilePath)
        const fileName = path.basename(relativePath);
        return !ignoreList.includes(fileName);
      })
  }
);

module.exports = {
  zksolc: {
    version: "1.3.1",
    compilerSource: "binary",
    settings: {
      isSystem: true,
    },
  },
  defaultNetwork: "zksync_testnet_goerli",
  solidity: soliditySettings,
  networks: {
    "zksync_testnet_goerli": {
      accounts: [process.env.PRIVATE_KEY],
      url: "https://zksync2-testnet.zksync.dev",
      ethNetwork: "goerli",
      zksync: true,
      verifyURL: 'https://zksync2-testnet-explorer.zksync.dev/contract_verification'
    },
  },
};

require("@matterlabs/hardhat-zksync-deploy");
require("@matterlabs/hardhat-zksync-solc");
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
    version: "1.2.2",
    compilerSource: "binary",
    settings: {},
  },
  defaultNetwork: "zksync-goerli",
  solidity: soliditySettings,
  networks: {
    "zksync-goerli": {
      accounts: [process.env.PRIVATE_KEY],
      url: "https://zksync2-testnet.zksync.dev",
      ethNetwork: "goerli",
      zksync: true,
    },
  },
};

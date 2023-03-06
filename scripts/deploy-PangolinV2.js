const { ethers } = require("hardhat");
const fs = require("fs");
const { CHAINS } = require("@pangolindex/sdk");

function delay(timeout) {
    return new Promise((resolve) => {
        setTimeout(resolve, timeout);
    });
}

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("\nDeployer:", deployer.address);

    const initBalance = await deployer.getBalance();
    console.log("Balance:", ethers.utils.formatEther(initBalance) + "\n");

    console.log("\n============\n DEPLOYMENT \n============");

    const wethFactory = await ethers.getContractFactory("WAVAX");

    const CHAINID = ethers.provider.network.chainId == 31337 ? 43113 : ethers.provider.network.chainId;
    const WETH = await wethFactory.attach(CHAINS[CHAINID].contracts.wrapped_native_token);

    const factoryFactory = await ethers.getContractFactory('PangolinV2Factory');
    const factory = await factoryFactory.deploy();
    console.log("Deployed PangolinV2 Factory: " + factory.address);

    const nftDescriptorLibraryFactory = await ethers.getContractFactory('NFTDescriptor');
    const nftDescriptorLibrary = await nftDescriptorLibraryFactory.deploy();
    console.log("Deployed NFTDescriptor Library: " + nftDescriptorLibrary.address);

    const nftDescriptorFactory = await ethers.getContractFactory('NonfungibleTokenPositionDescriptor', {
      libraries: {
        NFTDescriptor: nftDescriptorLibrary.address,
      },
    })
    const nftDescriptor = await nftDescriptorFactory.deploy(WETH.address);
    console.log("Deployed NFTDescriptor: " + nftDescriptor.address);

    const nftManagerFactory = await ethers.getContractFactory('NonfungiblePositionManager');
    const nftManager = await nftManagerFactory.deploy(factory.address, WETH.address, nftDescriptor.address);
    console.log("Deployed NFTManager: " + nftManager.address);

    const swapRouterFactory = await ethers.getContractFactory('SwapRouter');
    const swapRouter = await swapRouterFactory.deploy(factory.address, WETH.address);
    console.log("Deployed SwapRouter: " + swapRouter.address);

    const migratorFactory = await ethers.getContractFactory('V2Migrator');
    const migrator = await migratorFactory.deploy(factory.address, WETH.address, nftManager.address);
    console.log("Deployed Migrator: " + migrator.address);

    const endBalance = await deployer.getBalance();
    console.log(
        "\nDeploy cost:",
        ethers.utils.formatEther(initBalance.sub(endBalance)) + "\n"
    );
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


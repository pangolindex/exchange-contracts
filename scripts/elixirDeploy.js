const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");
const fs = require("fs");
require('dotenv').config();

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

    //const implementationDeployCost = ethers.utils.parseEther("1").div("10"); // approximate

    //const poolDeployer = new ethers.Wallet(process.env.IMPLEMENTATION_DEPLOYER_PRIVATE_KEY, ethers.provider);
    //await deployer.sendTransaction({ to: poolDeployer.address, value: implementationDeployCost });
    //const poolFactory = await ethers.getContractFactory("ElixirPool");
    //const pool = await poolFactory.connect(poolDeployer).deploy();
    //console.log("Deployed `ElixirPool` Implementation: " + pool.address);

    const POOL_IMPLEMENTATION = "0x5cB5539A18591947C82f5D840B05ed79f6395491";
    //const POOL_IMPLEMENTATION = pool.address;

    //const wethFactory = await ethers.getContractFactory("WAVAX");
    //const weth = await wethFactory.deploy();
    //console.log("Deployed `WAVAX`:", weth.address);

    const WETH_ADDRESS = "0xcF5ef8d007a616066e5eaEa0916592374a0F478D";
    //const WETH_ADDRESS = weth.address;

    const factoryFactory = await ethers.getContractFactory('ElixirFactory');
    const factory = await factoryFactory.deploy(POOL_IMPLEMENTATION);
    console.log("Deployed `ElixirFactory`: " + factory.address);

    const nftDescriptorLibraryFactory = await ethers.getContractFactory('NFTDescriptor');
    const nftDescriptorLibrary = await nftDescriptorLibraryFactory.deploy();
    console.log("Deployed `NFTDescriptor` library: " + nftDescriptorLibrary.address);

    const nftDescriptorFactory = await ethers.getContractFactory('NonfungibleTokenPositionDescriptor', {
      libraries: {
        NFTDescriptor: nftDescriptorLibrary.address,
      },
    })
    const nftDescriptor = await nftDescriptorFactory.deploy(weth.address);
    console.log("Deployed `NonfungibleTokenPositionDescriptor`: " + nftDescriptor.address);

    const nftManagerFactory = await ethers.getContractFactory('NonfungiblePositionManager');
    const nftManager = await nftManagerFactory.deploy(factory.address, weth.address, nftDescriptor.address, ethers.constants.AddressZero);
    console.log("Deployed `NonfungiblePositionManager`: " + nftManager.address);

    const swapRouterFactory = await ethers.getContractFactory('SwapRouter');
    const swapRouter = await swapRouterFactory.deploy(factory.address, weth.address);
    console.log("Deployed `SwapRouter`: " + swapRouter.address);

    const migratorFactory = await ethers.getContractFactory('ElixirMigrator');
    const migrator = await migratorFactory.deploy(factory.address, weth.address, nftManager.address);
    console.log("Deployed `ElixirMigrator`: " + migrator.address);

    const multicallFactory = await ethers.getContractFactory('ElixirInterfaceMulticall');
    const multicall = await multicallFactory.deploy();
    console.log("Deployed `ElixirInterfaceMulticall`: " + multicall.address);

    const quoterFactory = await ethers.getContractFactory('ElixirQuoter');
    const quoter = await quoterFactory.deploy(factory.address, weth.address);
    console.log("Deployed `ElixirQuoter`: " + quoter.address);

    const tickLensFactory = await ethers.getContractFactory('TickLens');
    const tickLens = await tickLensFactory.deploy();
    console.log("Deployed `TickLens`: " + tickLens.address);
    console.log("\n============\n END DEPLOYMENT \n============");

    //console.log("\n============\n CHECKS \n============");

    //const TOKEN0_ADDRESS = "0xd65496fd859ef65fefdA4f8ac35964cbE86d9C57";
    //const TOKEN1_ADDRESS = "0xe739bd707c80336877BE41eb53a3abC4447f19a6";

    //const FEE = "500";
    //const ONE_SQRT_PRICE = BigNumber.from("2").pow("96");

    //await nftManager.createAndInitializePoolIfNecessary(TOKEN0_ADDRESS, TOKEN1_ADDRESS, FEE, ONE_SQRT_PRICE);

    //const actualPoolAddress = await factory.getPool(TOKEN0_ADDRESS, TOKEN1_ADDRESS, FEE);
    //const derivedPoolAddress = await quoter.getPool(TOKEN0_ADDRESS, TOKEN1_ADDRESS, FEE);
    //console.log("Actual pool address:  " + actualPoolAddress);
    //console.log("Derived pool address: " + derivedPoolAddress);

    //const bytecodePrefix = "3d602d80600a3d3981f3363d3d373d3d3d363d73";
    //const implementation = POOL_IMPLEMENTATION.slice(2).toLowerCase();
    //const bytecodeSuffix = "5af43d82803e903d91602b57fd5bf3";
    //const constructedBytecode = `0x${bytecodePrefix}${implementation}${bytecodeSuffix}`;
    //const initCodeHash = ethers.utils.keccak256(constructedBytecode);
    //const offChainDerivedAddress = ethers.utils.getCreate2Address(factory.address, "0xe204bca57d123be152d81dc593cf4397afba36aedfb31bcb4812f4d0e3ad8376", initCodeHash);
    //console.log("Off-chain derived:    " + offChainDerivedAddress);
    //console.log("All above addresses should be equal!");

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


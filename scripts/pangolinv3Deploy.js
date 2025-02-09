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
    //const poolFactory = await ethers.getContractFactory("PangolinV3Pool");
    //const pool = await poolFactory.connect(poolDeployer).deploy();
    //console.log("Deployed `PangolinV3Pool` Implementation: " + pool.address);

    const POOL_IMPLEMENTATION = "0x3b5C658112f0b8b64f72EcCd7f9bDaeB7Cf9E73F";
    //const POOL_IMPLEMENTATION = pool.address;

    //const wethFactory = await ethers.getContractFactory("WAVAX");
    //const weth = await wethFactory.deploy();
    //console.log("Deployed `WAVAX`:", WETH_ADDRESS);

    const delay = millis => new Promise((resolve, reject) => {
        setTimeout(_ => resolve(), millis)
      });

    const WETH_ADDRESS = "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7";
    //const WETH_ADDRESS = WETH_ADDRESS;

    const factoryFactory = await ethers.getContractFactory('PangolinV3Factory');
    const factory = await factoryFactory.deploy(POOL_IMPLEMENTATION);
    console.log("Deployed `PangolinV3Factory`: " + factory.address);

    await delay(2000);

    const nftDescriptorLibraryFactory = await ethers.getContractFactory('NFTDescriptor');
    const nftDescriptorLibrary = await nftDescriptorLibraryFactory.deploy();
    console.log("Deployed `NFTDescriptor` library: " + nftDescriptorLibrary.address);

    await delay(2000);

    const nftDescriptorFactory = await ethers.getContractFactory('NonfungibleTokenPositionDescriptor', {
      libraries: {
        NFTDescriptor: nftDescriptorLibrary.address,
      },
    })
    const nftDescriptor = await nftDescriptorFactory.deploy(WETH_ADDRESS);
    console.log("Deployed `NonfungibleTokenPositionDescriptor`: " + nftDescriptor.address);

    await delay(2000);

    const nftManagerFactory = await ethers.getContractFactory('NonfungiblePositionManager');
    const nftManager = await nftManagerFactory.deploy(factory.address, WETH_ADDRESS, nftDescriptor.address, ethers.constants.AddressZero);//(factory.address, WETH_ADDRESS, nftDescriptor.address, ethers.constants.AddressZero);
    console.log("Deployed `NonfungiblePositionManager`: " + nftManager.address);

    await delay(2000);

    const swapRouterFactory = await ethers.getContractFactory('SwapRouter');
    const swapRouter = await swapRouterFactory.deploy(factory.address, WETH_ADDRESS);
    console.log("Deployed `SwapRouter`: " + swapRouter.address);

    await delay(2000);

    const migratorFactory = await ethers.getContractFactory('PangolinV3Migrator');
    const migrator = await migratorFactory.deploy(factory.address, WETH_ADDRESS, nftManager.address);
    console.log("Deployed `PangolinV3Migrator`: " + migrator.address);

    await delay(2000);

    const multicallFactory = await ethers.getContractFactory('PangolinV3InterfaceMulticall');
    const multicall = await multicallFactory.deploy();
    console.log("Deployed `PangolinV3InterfaceMulticall`: " + multicall.address);

    await delay(2000);

    const quoterFactory = await ethers.getContractFactory('PangolinV3Quoter');
    const quoter = await quoterFactory.deploy(factory.address, WETH_ADDRESS);
    console.log("Deployed `PangolinV3Quoter`: " + quoter.address);

    await delay(2000);

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


const { ethers } = require("hardhat");
const fs = require("fs");
const { CHAINS } = require("@pangolindex/sdk");
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

    const implementationDeployCost = ethers.utils.parseEther("1").div("5"); // approximate

    console.log("\n============\n DEPLOYMENT \n============");

    const poolDeployer = new ethers.Wallet(process.env.IMPLEMENTATION_DEPLOYER_PRIVATE_KEY, ethers.provider);
    await deployer.sendTransaction({ to: poolDeployer.address, value: implementationDeployCost });
    const poolFactory = await ethers.getContractFactory("ElixirPool");
    const pool = await poolFactory.connect(poolDeployer).deploy();
    console.log("Deployed Elixir Pool Implementation: " + pool.address);


    console.log("\n============\n END DEPLOYMENT \n============");

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



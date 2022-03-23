const { ethers } = require('hardhat');

const { PNG_ADDRESS, MINICHEF_V2_ADDRESS } = require("./mainnet-constants");

async function main() {

    const [deployer] = await ethers.getSigners();

    console.log("Deploying contracts with the account:", deployer.address);

    const initBalance = await deployer.getBalance();
    console.log("Account balance:", initBalance.toString());

    const png = ethers.utils.getAddress(PNG_ADDRESS);
    const miniChefV2 = ethers.utils.getAddress(MINICHEF_V2_ADDRESS);

    // Deploy PangolinVoteCalculator
    const PangolinVoteCalculator = await ethers.getContractFactory("PangolinVoteCalculator");
    const pangolinVoteCalculator = await PangolinVoteCalculator.deploy(
      png,
      miniChefV2,
    );
    await pangolinVoteCalculator.deployed();

    console.log("PangolinVoteCalculator address: ", pangolinVoteCalculator.address);

    const endBalance = await deployer.getBalance();
    console.log("Deploy cost: ", initBalance.sub(endBalance).toString());
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });

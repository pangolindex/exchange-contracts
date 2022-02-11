const { ethers } = require('hardhat');

const {
    MINICHEF_V2, PNG_ADDRESS,
} = require('./mainnet-constants');

async function main() {

    // Change these values to specify the additional SuperFarm rewards
    // ---------------------------------------------------------------
    const additionalRewardConfig = [
        {
            address: PNG_ADDRESS,
            multiplier: '2' + '0'.repeat(18)
        }
    ];
    const baseRewardDecimals = 18; // This likely won't change
    const chefAddress = MINICHEF_V2; // This likely won't change
    // ---------------------------------------------------------------

    const [deployer] = await ethers.getSigners();

    console.log('Deploying contracts with the account:', deployer.address);

    const initBalance = await deployer.getBalance();
    console.log('Account balance: ', initBalance.toString());

    // Deploy Rewarder
    console.log(`Deploying RewarderViaMultiplier with ${additionalRewardConfig.length} additional rewards ...`);
    const RewarderViaMultiplier = await ethers.getContractFactory('RewarderViaMultiplier');
    const rewarderViaMultiplier = await RewarderViaMultiplier.deploy(
        additionalRewardConfig.map(entry => entry.address),
        additionalRewardConfig.map(entry => entry.multiplier),
        baseRewardDecimals,
        chefAddress
    );
    await rewarderViaMultiplier.deployed();
    console.log(`Deployed RewarderViaMultiplier: `, rewarderViaMultiplier.address);
    console.log();

    const endBalance = await deployer.getBalance();
    console.log('Deploy cost: ', initBalance.sub(endBalance).toString());
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });

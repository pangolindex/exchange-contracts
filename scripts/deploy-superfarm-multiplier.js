const { ethers } = require('hardhat');

const {
    MINICHEF_V2_ADDRESS,
} = require('./mainnet-constants');

async function main() {

    const [deployer] = await ethers.getSigners();

    console.log('Deploying contracts with the account:', deployer.address);

    const initBalance = await deployer.getBalance();
    console.log('Account balance: ', initBalance / (10 ** 18));

    // Change these values to specify the additional SuperFarm rewards
    // ---------------------------------------------------------------
    const additionalRewardConfig = [
        // WAVAX-UST
        [
            {
                reward: '0x120AD3e5A7c796349e591F1570D9f7980F4eA9cb', // LUNA (265.33)
                multiplier: '35' + '0'.repeat(2)
            },
            {
                reward: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX (1247.13)
                multiplier: '1644' + '0'.repeat(13)
            },
        ],
        // WAVAX-sAVAX
        [{
            reward: '0x8729438eb15e2c8b576fcc6aecda6a148776c0f5', // QI (2,100,000)
            multiplier: '2316497' + '0'.repeat(13) // 23.16497
        }],
    ];
    const baseRewardDecimals = 18; // This likely won't change
    const chefAddress = MINICHEF_V2_ADDRESS; // This likely won't change
    // ---------------------------------------------------------------

    const Token = await ethers.getContractFactory("Png");

    for (const config of additionalRewardConfig) {
        // Get rewards info
        const symbols = [];
        for (const rewardAddress of config.map(c => c.reward)) {
            const rewardSymbol = await Token.attach(rewardAddress).symbol();
            symbols.push(rewardSymbol);
        }

        // Deploy Rewarder
        console.log(`Deploying RewarderViaMultiplier with ${config.length} additional rewards (${symbols.join(',')}) ...`);
        const RewarderViaMultiplier = await ethers.getContractFactory('RewarderViaMultiplier');
        const rewarderViaMultiplier = await RewarderViaMultiplier.deploy(
            config.map(entry => entry.reward),
            config.map(entry => entry.multiplier),
            baseRewardDecimals,
            chefAddress
        );
        await rewarderViaMultiplier.deployed();
        console.log(`Deployed RewarderViaMultiplier: `, rewarderViaMultiplier.address);
        console.log();
    }

    const endBalance = await deployer.getBalance();
    console.log('Deploy cost: ', initBalance.sub(endBalance) / (10 ** 18));
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });

const { ethers } = require('hardhat');

async function main() {

    // CONFIG. Change these values for different chains.

    // Flare
    //const funderAddresses = [
    //    "0xe688399009a1c283fad889d3cedf6fff4d685d51",
    //    "0xaca1a5601082f544299c80421fe69b08334d71c6",
    //    "0x003ed59911c4e50acab9c2c4d1a46026c95a4320",
    //    "0xe61e00782b49c60c5a819f8386f6d191cf45f6a6",
    //    "0x466e6b31249f5c5335d415169e7d15f194afdf16",
    //];
    //const emissionDiversionAddress = "0xe61E00782B49C60C5a819F8386f6d191Cf45f6a6";

    // Songbird
    const funderAddresses = [
        "0x56e4fa864a24fab95044c2cff18ec635a76f60ea",
        "0x7d84e8a7c89f84a97a0e190b45e4d2fc27412894",
        "0x7d3af25aea0e41f06735f2ce797516b8f34c3f9c",
        "0xe18dfc20ede326930d11b3316e92bdc1f606dc94",
        "0xe3a5fe55ff7a0c6e76fdd10ae80fa3f013b0a2cf",
        "0xda315a838e918026e51a864c43766f5ae86be8c6",
        "0x6d8467e9246ff94c465cb16c7731648e5cc6d176"
    ];
    const emissionDiversionAddress = "0xE3a5FE55FF7a0C6E76fDd10AE80fA3F013b0A2cf";

    // DEPLOYMENT.

    const [deployer] = await ethers.getSigners();

    console.log("Deploying contracts with the account:", deployer.address);

    // Define emission diversion contract.
    const emissionDiversionFactory = await ethers.getContractFactory("EmissionDiversionFromPangoChefToPangolinStakingPositions");
    const emissionDiversion = await emissionDiversionFactory.attach(emissionDiversionAddress);

    // Deploy safe funder contract.
    const safeFunderFactory = await ethers.getContractFactory("SafeFunderForPangolinStakingPositions");
    const safeFunder = await safeFunderFactory.deploy(emissionDiversionAddress);

    // Get role hashes.
    const funderRole = await safeFunder.FUNDER_ROLE();
    const adminRole = await safeFunder.DEFAULT_ADMIN_ROLE();

    // Define staking positions contract.
    const stakingPositionsAddress = await safeFunder.pangolinStakingPositions();
    const stakingPositionsFactory = await ethers.getContractFactory("PangolinStakingPositions");
    const stakingPositions = await stakingPositionsFactory.attach(stakingPositionsAddress);

    // Get admin address.
    const admin = await stakingPositions.getRoleMember(adminRole, 0);

    console.log("SafeFunder address: ", safeFunder.address);

    for (i = 0; i < funderAddresses.length; i++) {
        await safeFunder.grantRole(funderRole, funderAddresses[i]);
        console.log("Funder address: ", funderAddresses[i]);
    }

    await safeFunder.grantRole(adminRole, admin);
    console.log("Admin address: ", admin);

    await safeFunder.renounceRole(adminRole, deployer.address);
    console.log("Deployer renounced adminship.");
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });


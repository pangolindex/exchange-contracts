const { ethers } = require('hardhat');

// ---------------- Change these ------------------
const TIMELOCK_ADDRESS = '';
const PANGOLIN_STAKING_POSITIONS_ADDRESS = '';
const PROPOSAL_THRESHOLD = 0;
const PROPOSAL_THRESHOLD_MIN = 0;
const PROPOSAL_THRESHOLD_MAX = 0;
// ------------------------------------------------
async function main() {
    const contractName = 'GovernorPango';

    console.log(`Deploying ${contractName} ...`);

    const Contract = await ethers.getContractFactory(contractName);
    const contract = await Contract.deploy(
        TIMELOCK_ADDRESS,
        PANGOLIN_STAKING_POSITIONS_ADDRESS,
        PROPOSAL_THRESHOLD,
        PROPOSAL_THRESHOLD_MIN,
        PROPOSAL_THRESHOLD_MAX,
    );
    await contract.deployed();

    console.log(`${contractName} deployed at ${contract.address}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

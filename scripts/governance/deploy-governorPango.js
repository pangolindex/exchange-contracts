const { ethers } = require('hardhat');

// ---------------- Change these ------------------
const TIMELOCK_ADDRESS = '0xdA291D8daD1c55BBe828c91C58d16A523148bE11';
const PANGOLIN_STAKING_POSITIONS_ADDRESS = '0x997415e58dAEa9117027d55DAB7E765748C50834';
const PROPOSAL_THRESHOLD =      (10_000_000).toString() + '0'.repeat(18);
const PROPOSAL_THRESHOLD_MIN =   (1_000_000).toString() + '0'.repeat(18);
const PROPOSAL_THRESHOLD_MAX = (115_000_000).toString() + '0'.repeat(18);
// ------------------------------------------------
async function main() {
    const contractName = 'GovernorPango';

    console.log(`Deploying ${contractName} ...`);
    console.log(`Timelock:               ${TIMELOCK_ADDRESS}`);
    console.log(`Staking Contract:       ${PANGOLIN_STAKING_POSITIONS_ADDRESS}`);
    console.log(`Proposal Threshold:     ${PROPOSAL_THRESHOLD / 1e18}`);
    console.log(`Proposal Threshold Min: ${PROPOSAL_THRESHOLD_MIN / 1e18}`);
    console.log(`Proposal Threshold Max: ${PROPOSAL_THRESHOLD_MAX / 1e18}`);

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

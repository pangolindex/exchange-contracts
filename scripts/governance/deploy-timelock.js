const { ethers } = require('hardhat');

// ---------------- Change these ------------------
const ADMIN = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const DELAY = 0;
// ------------------------------------------------
async function main() {
    const contractName = 'Timelock';

    console.log(`Deploying ${contractName} ...`);

    const Contract = await ethers.getContractFactory(contractName);
    const contract = await Contract.deploy(
        ADMIN,
        DELAY,
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

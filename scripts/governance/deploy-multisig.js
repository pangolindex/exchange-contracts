const { ethers } = require('hardhat');
const { FOUNDATION_MULTISIG } = require('../../constants/shared.js');

async function main() {
    const contractName = 'MultiSigWallet';

    console.log(`Deploying ${contractName} ...`);

    const Contract = await ethers.getContractFactory(contractName);
    const contract = await Contract.deploy(
        FOUNDATION_MULTISIG.owners,
        FOUNDATION_MULTISIG.threshold,
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

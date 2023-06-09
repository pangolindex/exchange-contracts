const { ethers } = require('hardhat');

const MULTISIG_ADDRESS = '';
async function main() {
    const contractName = 'RegistrationCompliant';

    console.log(`Deploying ${contractName} ...`);

    const Contract = await ethers.getContractFactory(contractName);
    const contract = await Contract.deploy(MULTISIG_ADDRESS);
    await contract.deployed();

    console.log(`${contractName} deployed at ${contract.address}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

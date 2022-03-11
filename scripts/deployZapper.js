// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat");

async function main() {
    // We get the contract to deploy
    const Zapper = await hre.ethers.getContractFactory("MiniChefV2Zapper");
    const zapper = await Zapper.deploy(
        '0xE54Ca86531e17Ef3616d22Ca28b0D458b6C89106', // Router
        '0x1f806f7C8dED893fd3caE279191ad7Aa3798E928', // MiniChefV2
        '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
    );
    await zapper.deployed();

    console.log("Zapper deployed to:", zapper.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });

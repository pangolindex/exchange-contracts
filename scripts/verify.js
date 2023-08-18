const { ethers } = require("hardhat");
const { ADDRESSES } = require(`../addresses/${network.name}.js`);
const hre = require("hardhat");

async function main() {
    for (let i = 0; i < ADDRESSES.length; i++) {
        await hre
            .run("verify:verify", {
                address: ADDRESSES[i].address,
                constructorArguments: ADDRESSES[i].args,
            })
            .catch((error) => {
                console.error(error);
                console.log("SKIPPING TO THE NEXT CONTRACT!!!");
                //process.exit(1);
            });
    }
}

main();

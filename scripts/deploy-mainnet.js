const { Deployer } = require("@matterlabs/hardhat-zksync-deploy");
const { ethers } = require("hardhat");
const fs = require("fs");
const { FOUNDATION_MULTISIG } = require("../constants/shared.js");
const {
    PNG_SYMBOL,
    PNG_NAME,
    TOTAL_SUPPLY,
    USE_GNOSIS_SAFE,
    WRAPPED_NATIVE_TOKEN,
    INITIAL_MINT,
    AIRDROP_AMOUNT,
    AIRDROP_MERKLE_ROOT,
    VESTER_ALLOCATIONS,
    REVENUE_DISTRIBUTION,
    START_VESTING,
    LINEAR_VESTING,
    VESTING_COUNT,
    TIMELOCK_DELAY,
    WETH_PNG_FARM_ALLOCATION
} = require(`../constants/${network.name}.js`);
if (USE_GNOSIS_SAFE) {
    var { EthersAdapter, SafeFactory } = require("@gnosis.pm/safe-core-sdk");
}

const FUNDER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("FUNDER_ROLE"));
const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));
const POOL_MANAGER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("POOL_MANAGER_ROLE"));
const HARVEST_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("HARVEST_ROLE"));
const PAUSE_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("PAUSE_ROLE"));
const RECOVERY_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("RECOVERY_ROLE"));
const GOVERNOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("GOVERNOR_ROLE"));
const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

var contracts = [];

function delay(timeout) {
    return new Promise((resolve) => {
        setTimeout(resolve, timeout);
    });
}

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("\nDeployer:", deployer.address);

    const initBalance = await deployer.getBalance();
    console.log("Balance:", ethers.utils.formatEther(initBalance) + "\n");

    const pangolinPairFactory = await ethers.getContractFactory("PangolinPair");
    const pangolinPairInitHash = ethers.utils.keccak256(pangolinPairFactory.bytecode);

    if (USE_GNOSIS_SAFE) {
        console.log("✅ Using Gnosis Safe.");
    } else {
        console.log("⚠️  Using legacy multisig.");
    }
    if (WRAPPED_NATIVE_TOKEN === undefined || WRAPPED_NATIVE_TOKEN == "") {
        console.log("⚠️  No wrapped gas token is defined.");
    } else {
        console.log("✅ An existing wrapped gas token is defined.");
    }

    // dirty hack to circumvent duplicate nonce submission error
    var txCount = await ethers.provider.getTransactionCount(deployer.address);
    async function confirmTransactionCount() {
        await delay(5000);
        let newTxCount;
        while (true) {
            try {
                newTxCount = await ethers.provider.getTransactionCount(
                    deployer.address
                );
                if (newTxCount != txCount + 1) {
                    continue;
                }
                txCount++;
            } catch (err) {
                console.log(err);
                process.exit(0);
            }
            break;
        }
    }

    async function deploy(factory, args) {
        await delay(5000);
        var ContractFactory = await ethers.getContractFactory(factory);
        var contract = await ContractFactory.deploy(...args);
        await contract.deployed();
        contracts.push({ address: contract.address, args: args });
        await confirmTransactionCount();
        console.log(contract.address, ":", factory);
        return contract;
    }

    console.log("\n============\n DEPLOYMENT \n============");

    // Deploy WAVAX if not defined
    if (WRAPPED_NATIVE_TOKEN === undefined) {
        var nativeToken = (await deploy("WAVAX", [])).address;
    } else {
        var nativeToken = WRAPPED_NATIVE_TOKEN;
        console.log(nativeToken, ": WAVAX");
    }

    /**************
     * GOVERNANCE *
     **************/

    // Deploy PNG
    const png = await deploy("Png", [
        ethers.utils.parseUnits(TOTAL_SUPPLY.toString(), 18),
        ethers.utils.parseUnits(INITIAL_MINT.toString(), 18),
        PNG_NAME,
        PNG_SYMBOL,
    ]);

    // Deploy foundation multisig
    if (USE_GNOSIS_SAFE) {
        const ethAdapter = new EthersAdapter({
            ethers,
            signer: deployer,
        });
        var Multisig = await SafeFactory.create({ ethAdapter });
        var foundation = await Multisig.deploySafe(FOUNDATION_MULTISIG);
        await confirmTransactionCount();
        foundation.address = foundation.getAddress();
        console.log(foundation.address, ": Gnosis");
    } else {
        var foundation = await deploy("MultiSigWallet", [
            FOUNDATION_MULTISIG.owners,
            FOUNDATION_MULTISIG.threshold
        ]);
    }

    const timelock = await deploy("Timelock", [
        foundation.address,
        TIMELOCK_DELAY,
    ]);
    const factory = await deploy("PangolinFactory", [deployer.address]);
    const router = await deploy("PangolinRouter", [
        factory.address,
        nativeToken,
    ]);
    const treasury = await deploy("CommunityTreasury", [png.address]);

    await factory.createPair(png.address, nativeToken);
    await confirmTransactionCount();

    const chef = await deploy("PangoChef", [
        png.address,
        deployer.address,
        factory.address,
        nativeToken
    ]);
    const chefFundForwarder = await deploy("RewardFundingForwarder", [chef.address]);

    const stakingMetadata = await deploy("TokenMetadata", [foundation.address, PNG_SYMBOL]);
    const staking = await deploy("PangolinStakingPositions", [
        png.address,
        deployer.address,
        stakingMetadata.address
    ]);
    const stakingFundForwarder = await deploy("RewardFundingForwarder", [staking.address]);

    // Deploy Airdrop
    const airdrop = await deploy("MerkledropToStaking", [
        png.address,
        staking.address,
        deployer.address,
    ]);

    // Deploy TreasuryVester
    var vesterAllocations = [];
    for (let i = 0; i < VESTER_ALLOCATIONS.length; i++) {
        let recipientAddress;
        let isMiniChef;
        if (VESTER_ALLOCATIONS[i].recipient == "treasury") {
            recipientAddress = treasury.address;
            isMiniChef = false;
        } else if (VESTER_ALLOCATIONS[i].recipient == "multisig") {
            recipientAddress = foundation.address;
            isMiniChef = false;
        } else if (VESTER_ALLOCATIONS[i].recipient == "chef") {
            recipientAddress = chefFundForwarder.address;
            isMiniChef = true;
        }

        vesterAllocations.push([
            recipientAddress,
            VESTER_ALLOCATIONS[i].allocation,
            isMiniChef,
        ]);
    }
    const vester = LINEAR_VESTING
        ? await deploy("TreasuryVesterLinear", [
            png.address, // vested token
            vesterAllocations,
            foundation.address,
            ethers.utils.parseUnits((TOTAL_SUPPLY - INITIAL_MINT).toString(), 18).div(VESTING_COUNT),
        ])
        : await deploy("TreasuryVester", [
            png.address, // vested token
            ethers.utils.parseUnits((TOTAL_SUPPLY - INITIAL_MINT).toString(), 18),
            vesterAllocations,
            foundation.address,
        ]);

    /*****************
     * FEE COLLECTOR *
     *****************/

    // Deploy Fee Collector
    const feeCollector = await deploy("FeeCollector", [
        nativeToken,
        factory.address,
        pangolinPairInitHash,
        staking.address,
        ethers.constants.AddressZero,
        "0",
        foundation.address,
        timelock.address,
        foundation.address
    ]);

    console.log("\n===============\n CONFIGURATION \n===============");

    await airdrop.setMerkleRoot(AIRDROP_MERKLE_ROOT);
    await confirmTransactionCount();
    console.log("Set airdrop merkle root.");

    if (START_VESTING) {
        await airdrop.unpause();
        await confirmTransactionCount();
        console.log("Unpaused airdrop claiming.");
    }

    await airdrop.transferOwnership(foundation.address);
    await confirmTransactionCount();
    console.log("Transferred airdrop ownership to multisig.");

    await treasury.transferOwnership(timelock.address);
    await confirmTransactionCount();
    console.log("Transferred CommunityTreasury ownership to Timelock.");

    await png.grantRole(MINTER_ROLE, vester.address);
    await confirmTransactionCount();
    console.log("Gave PNG minting role to TreasuryVester.");

    await png.grantRole(DEFAULT_ADMIN_ROLE, foundation.address);
    await confirmTransactionCount();
    await png.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address);
    await confirmTransactionCount();
    console.log("Renounced PNG admin role to multisig.");

    await png.transfer(
        airdrop.address,
        ethers.utils.parseUnits(AIRDROP_AMOUNT.toString(), 18)
    );
    await confirmTransactionCount();
    console.log(
        "Transferred",
        AIRDROP_AMOUNT.toString(),
        PNG_SYMBOL,
        "to Airdrop."
    );

    await png.transfer(
        foundation.address,
        ethers.utils.parseUnits((INITIAL_MINT - AIRDROP_AMOUNT).toString(), 18)
    );
    await confirmTransactionCount();
    console.log(
        "Transferred",
        (INITIAL_MINT - AIRDROP_AMOUNT).toString(),
        PNG_SYMBOL,
        "to Multisig."
    );

    if (START_VESTING) {
        await vester.startVesting();
        await confirmTransactionCount();
        console.log("Token vesting began.");
    }

    await vester.transferOwnership(timelock.address);
    await confirmTransactionCount();
    console.log("Transferred TreasuryVester ownership to Timelock.");

    // change swap fee recipient to fee collector
    await factory.setFeeTo(feeCollector.address);
    await confirmTransactionCount();
    console.log("Set FeeCollector as the swap fee recipient.");

    await factory.setFeeToSetter(foundation.address);
    await confirmTransactionCount();
    console.log("Transferred PangolinFactory ownership to Multisig.");

    /*******************
     * PANGOCHEF ROLES *
     *******************/

    await chef.grantRole(FUNDER_ROLE, vester.address);
    await confirmTransactionCount();
    await chef.grantRole(FUNDER_ROLE, chefFundForwarder.address);
    await confirmTransactionCount();
    await chef.grantRole(FUNDER_ROLE, foundation.address);
    await confirmTransactionCount();
    await chef.grantRole(POOL_MANAGER_ROLE, foundation.address);
    await confirmTransactionCount();
    await chef.grantRole(DEFAULT_ADMIN_ROLE, foundation.address);
    await confirmTransactionCount();
    console.log("Added TreasuryVester as PangoChef funder.");

    await chef.setWeights(["0"], [WETH_PNG_FARM_ALLOCATION]);
    await confirmTransactionCount();
    console.log("Gave 30x weight to PNG-NATIVE_TOKEN");

    await chef.renounceRole(FUNDER_ROLE, deployer.address);
    await confirmTransactionCount();
    await chef.renounceRole(POOL_MANAGER_ROLE, deployer.address);
    await confirmTransactionCount();
    await chef.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address);
    await confirmTransactionCount();
    console.log("Transferred PangoChef ownership to Multisig.");

    /************************* *
     * STAKING POSITIONS ROLES *
     ************************* */

    await staking.grantRole(FUNDER_ROLE, feeCollector.address);
    await confirmTransactionCount();
    await staking.grantRole(FUNDER_ROLE, stakingFundForwarder.address);
    await confirmTransactionCount();
    await staking.grantRole(FUNDER_ROLE, foundation.address);
    await confirmTransactionCount();
    await staking.grantRole(DEFAULT_ADMIN_ROLE, foundation.address);
    await confirmTransactionCount();
    console.log("Added FeeCollector as PangolinStakingPosition funder.");

    await staking.renounceRole(FUNDER_ROLE, deployer.address);
    await confirmTransactionCount();
    await staking.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address);
    await confirmTransactionCount();
    console.log("Transferred PangolinStakingPositions ownership to Multisig.");

    const endBalance = await deployer.getBalance();
    console.log(
        "\nDeploy cost:",
        ethers.utils.formatEther(initBalance.sub(endBalance)) + "\n"
    );
    console.log(
        "Recorded contract addresses to `addresses/" + network.name + ".js`."
    );
    console.log("Refer to `addresses/README.md` for Etherscan verification.\n");

    try {
        fs.writeFileSync(
            "addresses/" + network.name + ".js",
            "exports.ADDRESSES=" + JSON.stringify(contracts)
        );
        //file written successfully
    } catch (err) {
        console.error(err);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

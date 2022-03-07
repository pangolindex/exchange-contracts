const { ethers } = require("hardhat");
const fs = require("fs");
const { FOUNDATION_MULTISIG } = require("../constants/shared.js");
const  abi  = require("../constants/abi.js");
const {
    PNG_SYMBOL,
    PNG_NAME,
    TOTAL_SUPPLY,
    MULTISIG,
    MULTISIG_ADDRESS,
    FOUNDATION_ADDRESS,
    USE_GNOSIS_SAFE,
    PROPOSAL_THRESHOLD,
    WRAPPED_NATIVE_TOKEN,
    INITIAL_FARMS,
    AIRDROP_AMOUNT,
    VESTER_ALLOCATIONS,
    REVENUE_DISTRIBUTION,
    TIMELOCK_DELAY,
    PNG_STAKING_ALLOCATION,
    WETH_PNG_FARM_ALLOCATION,
} = require(`../constants/${network.name}.js`);
if (USE_GNOSIS_SAFE) {
    var { EthersAdapter, SafeFactory } = require("@gnosis.pm/safe-core-sdk");
}

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

    if (USE_GNOSIS_SAFE) {
        console.log("✅ Using Gnosis Safe.");
    } else {
        console.log("⚠️  Using legacy multisig.");
    }
    if (MULTISIG_ADDRESS) {
        console.log("✅ Using Multisig already deploy.");
    } else {
        console.log("⚠️  No Multisig is defined.");
    }
    if (FOUNDATION_ADDRESS) {
        console.log("✅ Using FoundationMultisig already deploy.");
    } else {
        console.log("⚠️  No Foundation Multisig is defined.");
    }
    if (WRAPPED_NATIVE_TOKEN === undefined || WRAPPED_NATIVE_TOKEN == "") {
        console.log("⚠️  No wrapped gas token is defined.");
    } else {
        console.log("✅ An existing wrapped gas token is defined.");
    }
    if (INITIAL_FARMS.length === 0 || INITIAL_FARMS === undefined) {
        console.log("⚠️  No initial farm is defined.");
    }

    // dirty hack to circumvent duplicate nonce submission error
    var txCount = await ethers.provider.getTransactionCount(deployer.address);
    async function confirmTransactionCount() {
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
        ethers.utils.parseUnits(AIRDROP_AMOUNT.toString(), 18),
        PNG_SYMBOL,
        PNG_NAME,
    ]);

    // Deploy this chain’s multisig
    if (MULTISIG_ADDRESS === undefined) {
        if (USE_GNOSIS_SAFE) {
            const ethAdapter = new EthersAdapter({
                ethers,
                signer: deployer,
            });
            var Multisig = await SafeFactory.create({ ethAdapter });
            var multisig = await Multisig.deploySafe(MULTISIG);
            await confirmTransactionCount();
            multisig.address = multisig.getAddress();
            console.log(multisig.address, ": Gnosis");
        } else {
            var multisig = await deploy("MultiSigWalletWithDailyLimit", [
                MULTISIG.owners,
                MULTISIG.threshold,
                0,
            ]);
        }
    } else {
        const multisig = new ethers.Contract(MULTISIG_ADDRESS, abi.MultiSigWallet, deployer);
        console.log(multisig.address, ": MultiSigWalletWithDailyLimit");
    }

    // Deploy foundation multisig
    if (FOUNDATION_ADDRESS === undefined) {
        if (USE_GNOSIS_SAFE) {
            var foundation = await Multisig.deploySafe(FOUNDATION_MULTISIG);
            await confirmTransactionCount();
            foundation.address = foundation.getAddress();
            console.log(foundation.address, ": Gnosis");
        } else {
            var foundation = await deploy("MultiSigWalletWithDailyLimit", [
                FOUNDATION_MULTISIG.owners,
                FOUNDATION_MULTISIG.threshold,
                0,
            ]);
        }
    } else {
        const foundation = new ethers.Contract(FOUNDATION_ADDRESS, abi.MultiSigWallet, deployer);
        console.log(foundation.address, ": MultiSigWalletWithDailyLimit");
    }

    const timelock = await deploy("Timelock", [
        multisig.address,
        TIMELOCK_DELAY,
    ]);
    const factory = await deploy("PangolinFactory", [deployer.address]);
    const router = await deploy("PangolinRouter", [
        factory.address,
        nativeToken,
    ]);
    const chef = await deploy("MiniChefV2", [png.address, deployer.address]);
    const treasury = await deploy("CommunityTreasury", [png.address]);
    const staking = await deploy("StakingRewards", [png.address, png.address]);

    // Deploy Airdrop
    const airdrop = await deploy("Airdrop", [
        ethers.utils.parseUnits(AIRDROP_AMOUNT.toString(), 18),
        png.address,
        multisig.address,
        treasury.address,
    ]);

    // Deploy TreasuryVester
    var vesterAllocations = [];
    for (let i = 0; i < VESTER_ALLOCATIONS.length; i++) {
        vesterAllocations.push([
            eval(VESTER_ALLOCATIONS[i].recipient + ".address"),
            VESTER_ALLOCATIONS[i].allocation,
            VESTER_ALLOCATIONS[i].isMiniChef,
        ]);
    }
    const vester = await deploy("TreasuryVester", [
        png.address, // vested token
        ethers.utils.parseUnits((TOTAL_SUPPLY - AIRDROP_AMOUNT).toString(), 18),
        vesterAllocations,
        multisig.address,
    ]);

    /*****************
     * FEE COLLECTOR *
     *****************/

    // Deploy 2/2 Joint Multisig
    if (USE_GNOSIS_SAFE) {
        var jointMultisig = await Multisig.deploySafe({
            owners: [multisig.address, foundation.address],
            threshold: 2,
        });
        await confirmTransactionCount();
        jointMultisig.address = jointMultisig.getAddress();
        console.log(jointMultisig.address, ": Gnosis");
    } else {
        var jointMultisig = await deploy("MultiSigWalletWithDailyLimit", [
            [multisig.address, foundation.address],
            2,
            0,
        ]);
    }

    // Deploy Revenue Distributor (Joint treasury of PNG and FPNG)
    var revenueDistribution = [];
    for (let i = 0; i < REVENUE_DISTRIBUTION.length; i++) {
        revenueDistribution.push([
            eval(REVENUE_DISTRIBUTION[i].recipient + ".address"),
            REVENUE_DISTRIBUTION[i].allocation,
        ]);
    }
    const revenueDistributor = await deploy("RevenueDistributor", [
        revenueDistribution,
    ]);

    // Deploy Fee Collector
    const feeCollector = await deploy("PangolinFeeCollector", [
        staking.address,
        router.address,
        chef.address,
        0, // chef pid for dummy PGL
        timelock.address,
        nativeToken,
        revenueDistributor.address,
    ]);

    // Deploy DummyERC20 for diverting some PNG emissions to PNG staking
    const dummyERC20 = await deploy("DummyERC20", [
        "Dummy ERC20",
        "PGL",
        deployer.address,
        100, // arbitrary amount
    ]);

    console.log("\n===============\n CONFIGURATION \n===============");

    await treasury.transferOwnership(timelock.address);
    await confirmTransactionCount();
    console.log("Transferred CommunityTreasury ownership to Timelock.");

    await png.setMinter(vester.address);
    await confirmTransactionCount();
    console.log("Transferred PNG minter role to TreasuryVester.");

    await png.setAdmin(timelock.address);
    await confirmTransactionCount();
    console.log("Transferred PNG ownership to Timelock.");

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

    await vester.transferOwnership(timelock.address);
    await confirmTransactionCount();
    console.log("Transferred TreasuryVester ownership to Timelock.");

    await revenueDistributor.transferOwnership(jointMultisig.address);
    await confirmTransactionCount();
    console.log("Transferred RevenueDistributor ownership to Joint Multisig.");

    await feeCollector.transferOwnership(multisig.address);
    await confirmTransactionCount();
    console.log("Transferred FeeCollector ownership to Multisig.");

    await dummyERC20.renounceOwnership();
    await confirmTransactionCount();
    console.log("Renounced DummyERC20 ownership.");

    // add dummy PGL to minichef
    await chef.addPool(
        PNG_STAKING_ALLOCATION,
        dummyERC20.address,
        ethers.constants.AddressZero
    );
    await confirmTransactionCount();
    console.log("Added MiniChefV2 pool 0 for FeeCollector.");

    // deposit dummy PGL for the fee collector
    await dummyERC20.approve(chef.address, 100);
    await confirmTransactionCount();
    await chef.deposit(
        0, // minichef pid
        100, // amount
        feeCollector.address // deposit to address
    );
    await confirmTransactionCount();
    console.log("Deposited DummyERC20 to MiniChefV2 pool 0.");

    // change swap fee recipient to fee collector
    await factory.setFeeTo(feeCollector.address);
    await confirmTransactionCount();
    console.log("Set FeeCollector as the swap fee recipient.");

    await factory.setFeeToSetter(multisig.address);
    await confirmTransactionCount();
    console.log("Transferred PangolinFactory ownership to Multisig.");

    /********************
     * MINICHEFv2 FARMS *
     ********************/

    await factory.createPair(png.address, nativeToken);
    await confirmTransactionCount();
    var pngPair = await factory.getPair(png.address, nativeToken);
    await chef.addPool(
        WETH_PNG_FARM_ALLOCATION,
        pngPair,
        ethers.constants.AddressZero
    );
    await confirmTransactionCount();
    console.log("Added MiniChef pool 1 for WAVAX-PNG.");

    // create native token paired farms for tokens in INITIAL_FARMS
    for (let i = 0; i < INITIAL_FARMS.length; i++) {
        let tokenA = INITIAL_FARMS[i]["tokenA"];
        let tokenB = INITIAL_FARMS[i]["tokenB"];
        let weight = INITIAL_FARMS[i]["weight"];
        await factory.createPair(tokenA, tokenB);
        await confirmTransactionCount();
        let pair = await factory.getPair(tokenA, tokenB);
        await chef.addPool(weight, pair, ethers.constants.AddressZero);
        await confirmTransactionCount();
    }
    const pools = await chef.poolInfos();
    if (pools.length > 2)
        console.log(
            "Added",
            (pools.length - 2).toString(),
            "more farms to MiniChefV2."
        );

    await chef.addFunder(vester.address);
    await confirmTransactionCount();
    console.log("Added TreasuryVester as MiniChefV2 funder.");

    await chef.transferOwnership(multisig.address);
    await confirmTransactionCount();
    console.log("Transferred MiniChefV2 ownership to Multisig.");

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

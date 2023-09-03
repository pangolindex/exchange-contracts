const { ethers } = require("hardhat");
const { ALL_CHAINS, CHAINS, ChainId } = require("@pangolindex/sdk");
const {
  PNG_SYMBOL,
  PNG_NAME,
  WRAPPED_NATIVE_TOKEN,
  VESTER_ALLOCATIONS,
  REVENUE_DISTRIBUTION,
  WETH_PNG_FARM_ALLOCATION,
} = require(`../constants/${network.name}.js`);

const FUNDER_ROLE = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes("FUNDER_ROLE")
);
const MINTER_ROLE = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes("MINTER_ROLE")
);
const POOL_MANAGER_ROLE = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes("POOL_MANAGER_ROLE")
);
const HARVEST_ROLE = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes("HARVEST_ROLE")
);
const PAUSE_ROLE = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes("PAUSE_ROLE")
);
const RECOVERY_ROLE = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes("RECOVERY_ROLE")
);
const GOVERNOR_ROLE = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes("GOVERNOR_ROLE")
);
const DEFAULT_ADMIN_ROLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

function delay(timeout) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("\nDeployer:", deployer.address);

  ////////////////////////////
  // CHANGE THESE VARIABLES //
  ////////////////////////////
  const isDeployingActive = true;
  const isImpersonatingActive = true;
  const contractAddresses = CHAINS[ChainId.FUJI].contracts;
  // png: contractAddresses.png
  // factory: contractAddresses.factory
  // nativeToken: contractAddresses.wrapped_native_token
  ////////////////////////////

  // dirty hack to circumvent duplicate nonce submission error
  let txCount = await ethers.provider.getTransactionCount(deployer.address);
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
    if (isDeployingActive) {
      await delay(5000);
      var ContractFactory = await ethers.getContractFactory(factory);
      var contract = await ContractFactory.deploy(...args);
      await contract.deployed();
      await confirmTransactionCount();
      console.log(contract.address, ":", factory);
      return contract;
    } else {
      console.log("Deploying is deactivated. Skipping...");
    }
  }

  // REQUIRED CONTRACT DEFINITION
  const treasuryVesterContract = await ethers.getContractAt(
    "TreasuryVester",
    contractAddresses.treasury_vester
  );

  const timelockAddress = await treasuryVesterContract.owner();
  const timelockContract = await ethers.getContractAt(
    "Timelock",
    timelockAddress
  );

  // ;
  const multisigAddress = await timelockContract.admin();
  const multisigContract = await ethers.getContractAt(
    "MultiSigWallet",
    multisigAddress
  );

  const feeCollectorContract = await ethers.getContractAt(
    "FeeCollector",
    contractAddresses.fee_collector
  );

  // DEPLOYING SAR FARM
  const chef = await deploy("PangoChef", [
    contractAddresses.png,
    deployer.address,
    contractAddresses.factory,
    contractAddresses.wrapped_native_token,
  ]);
  const chefFundForwarder = await deploy("RewardFundingForwarder", [
    chef.address,
  ]);

  // DEPLOYING SAR STAKING
  const stakingMetadata = await deploy("TokenMetadata", [
    multisigAddress,
    PNG_SYMBOL,
  ]);
  const staking = await deploy("PangolinStakingPositions", [
    contractAddresses.png,
    deployer.address,
    stakingMetadata.address,
  ]);
  const stakingFundForwarder = await deploy("RewardFundingForwarder", [
    staking.address,
  ]);
  const emissionDiversion = await deploy("EmissionDiversionFromPangoChefToPangolinStakingPositions", [
    chef.address,
    staking.address
  ]);

  console.log("\n===============\n CONFIGURATION \n===============");

  await chef.initializePool(emissionDiversion.address, 2); // relayer pool
  await confirmTransactionCount();

  await chef.grantRole(FUNDER_ROLE, contractAddresses.treasury_vester);
  await confirmTransactionCount();
  await chef.grantRole(FUNDER_ROLE, chefFundForwarder.address);
  await confirmTransactionCount();
  await chef.grantRole(FUNDER_ROLE, multisigAddress);
  await confirmTransactionCount();
  await chef.grantRole(POOL_MANAGER_ROLE, multisigAddress);
  await confirmTransactionCount();
  await chef.grantRole(DEFAULT_ADMIN_ROLE, multisigAddress);
  await confirmTransactionCount();
  console.log("Added TreasuryVester as PangoChef funder.");

  await chef.setWeights(["0"], [WETH_PNG_FARM_ALLOCATION]);
  await confirmTransactionCount();
  console.log("Gave 0 weight to PNG-NATIVE_TOKEN");

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

  await staking.grantRole(FUNDER_ROLE, contractAddresses.fee_collector);
  await confirmTransactionCount();
  await staking.grantRole(FUNDER_ROLE, stakingFundForwarder.address);
  await confirmTransactionCount();
  await staking.grantRole(FUNDER_ROLE, multisigAddress);
  await confirmTransactionCount();
  await staking.grantRole(DEFAULT_ADMIN_ROLE, multisigAddress);
  await confirmTransactionCount();
  console.log("Added FeeCollector as PangolinStakingPosition funder.");

  await staking.renounceRole(FUNDER_ROLE, deployer.address);
  await confirmTransactionCount();
  await staking.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address);
  await confirmTransactionCount();
  console.log("Transferred PangolinStakingPositions ownership to Multisig.");

  // Swapping new chef with old one in TreasuryVester
  var recipients = await treasuryVesterContract.getRecipients();
  const miniChefIndex = recipients.findIndex(
      (recipient) => recipient.account == contractAddresses.mini_chef.address
  );
  recipients[miniChefIndex].account = chefFundForwarder.address;

  const vesterTxEncode = treasuryVesterContract.interface.encodeFunctionData(
    "setRecipients",
    [recipients]
  );

  // getting timestamp
  const blockNumBefore = await ethers.provider.getBlockNumber();
  const blockBefore = await ethers.provider.getBlock(blockNumBefore);
  const timestampBefore = blockBefore.timestamp;

  const delayTime = await timelockContract.delay();
  // console.log(delayTime.toNumber());
  const timestamp = timestampBefore + delayTime.toNumber() + 10 * 60 * 60; // 10h

  const timelockTxData = {
    target: contractAddresses.treasury_vester,
    value: 0,
    signature: "setRecipients((address,uint256,bool)[])", // 77b872a8
    data: vesterTxEncode.slice(0, 2) + vesterTxEncode.slice(10), // to exclude signature hash (8byte) from data
    timestamp: timestamp,
  };
  // console.log(timelockTxData);

  let timelockTxEncode = timelockContract.interface.encodeFunctionData(
    "queueTransaction",
    [
      timelockTxData.target,
      timelockTxData.value,
      timelockTxData.signature,
      timelockTxData.data,
      timelockTxData.timestamp,
    ]
  ); // it is the transaction data to be embedded in multisig call to trigger timelock for queuing transaction.

  let multisigTxData = {
    destination: contractAddresses.timelock,
    value: 0,
    data: timelockTxEncode,
  }; // to send queueTransaction of timelock contract.

  console.log("First multisig tx to timelock to set vester allocations:");
  console.log("target: " + multisigTxData.destination);
  console.log("data: " + multisigTxData.data);

  timelockTxEncode = timelockContract.interface.encodeFunctionData(
    "executeTransaction",
    [
      timelockTxData.target,
      timelockTxData.value,
      timelockTxData.signature,
      timelockTxData.data,
      timelockTxData.timestamp,
    ]
  ); // it is the transaction data to be embedded in multisig call to trigger timelock for queuing transaction.

  multisigTxData = {
    destination: contractAddresses.timelock,
    value: 0,
    data: timelockTxEncode,
  }; // to send queueTransaction of timelock contract.

  console.log("Second multisig tx to timelock to finalize (must wait timelock delay for this):");
  console.log("target: " + multisigTxData.destination);
  console.log("data: " + multisigTxData.data);

  // CHANGING FEE COLLECTOR'S REWARD CONTRACT TO STAKING
  let hasRole = await feeCollectorContract.hasRole(
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    multisigAddress
  );
  !hasRole && console.log("Multisig doesn't have DEFAULT_ADMIN_ROLE");

  console.log("Sending setRewardsContract to feeCollector via multisig.");
  const feeCollectorTxEncode =
    feeCollectorContract.interface.encodeFunctionData("setRewardsContract", [
      stakingFundForwarder.address,
    ]);

  multisigTxData = {
    destination: contractAddresses.fee_collector,
    value: 0,
    data: feeCollectorTxEncode,
  }; // to send queueTransaction of timelock contract.

  console.log("Change fee collector recipient address multisig tx:");
  console.log("target: " + multisigTxData.destination);
  console.log("data: " + multisigTxData.data);

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });


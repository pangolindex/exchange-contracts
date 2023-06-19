import { abi as IElixirPoolABI } from "../../artifacts/contracts/elixir-core/interfaces/IElixirPool.sol/IElixirPool.json";
import { Fixture } from "ethereum-waffle";
import { BigNumberish, BigNumber, constants, Wallet } from "ethers";
import { ethers, waffle, network } from "hardhat";
import {
  IElixirFactory,
  IWETH9,
  MockTimeNonfungiblePositionManager,
  NonfungiblePositionManagerPositionsGasTest,
  SwapRouter,
  TestERC20,
  TestPositionNFTOwner,
} from "../../typechain";
import completeFixture from "../elixir-periphery/shared/completeFixture";
import { computePoolAddress } from "../elixir-periphery/shared/computePoolAddress";
import { FeeAmount, MaxUint128, TICK_SPACINGS } from "../elixir-periphery/shared/constants";
import { encodePriceSqrt } from "../elixir-periphery/shared/encodePriceSqrt";
import { expandTo18Decimals } from "../elixir-periphery/shared/expandTo18Decimals";
import { expect } from "../elixir-periphery/shared/expect";
import { extractJSONFromURI } from "../elixir-periphery/shared/extractJSONFromURI";
import getPermitNFTSignature from "../elixir-periphery/shared/getPermitNFTSignature";
import { encodePath } from "../elixir-periphery/shared/path";
import poolAtAddress from "../elixir-periphery/shared/poolAtAddress";
import snapshotGasCost from "../elixir-periphery/shared/snapshotGasCost";
import { getMaxTick, getMinTick } from "../elixir-periphery/shared/ticks";
import { sortedTokens } from "../elixir-periphery/shared/tokenSort";

function keccak256(value) {
    return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(value));
}

describe("ElixirRewarder", () => {
  let wallets: Wallet[];
  let wallet: Wallet, other: Wallet;

  const nftFixture: Fixture<{
    nft: MockTimeNonfungiblePositionManager;
    factory: IElixirFactory;
    tokens: [TestERC20, TestERC20, TestERC20];
    weth9: IWETH9;
    router: SwapRouter;
  }> = async (wallets, provider) => {
    ////// POOL IMPLEMENTATION DEPLOYMENT
    //  impersonating poolDeployer's account
    const poolDeployerAddress = "0x427207B1Cdb6F2Ab8B1D21Ab77600f00b0a639a7";
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [poolDeployerAddress],
    });

    const poolDeployer = await (ethers as any).getSigner(poolDeployerAddress);

    //  fund the impersonated account
    await wallets[0].sendTransaction({
      to: poolDeployerAddress,
      value: ethers.utils.parseEther("100"),
    });

    const poolFactory = await ethers.getContractFactory("ElixirPool");
    const poolImplementation = await poolFactory.connect(poolDeployer).deploy();
    //////

    const { weth9, factory, tokens, nft, router } = await completeFixture(
      wallets,
      provider
    );

    // approve & fund wallets
    for (const token of tokens) {
      await token.approve(nft.address, constants.MaxUint256);
      await token.connect(other).approve(nft.address, constants.MaxUint256);
      await token.transfer(other.address, expandTo18Decimals(1_000_000));
    }

    return {
      nft,
      factory,
      tokens,
      weth9,
      router,
    };
  };

  let factory: IElixirFactory;
  let nft: MockTimeNonfungiblePositionManager;
  let tokens: [TestERC20, TestERC20, TestERC20];
  let weth9: IWETH9;
  let router: SwapRouter;
  let rewarder: IElixirRewarder;
  let factoryOwner: IElixirFactoryOwner;

  let loadFixture: ReturnType<typeof waffle.createFixtureLoader>;

  before("create fixture loader", async () => {
    wallets = await (ethers as any).getSigners();
    [wallet, other] = wallets;

    loadFixture = waffle.createFixtureLoader(wallets);
  });

  beforeEach("load fixture", async () => {
    ({ nft, factory, tokens, weth9, router } = await loadFixture(nftFixture));
  });

  beforeEach("deploy rewarder and factory owner", async () => {
    // Use basic hardhat testing method because I don't know how to integrate this properly to fixtures.
    rewarder = await (await ethers.getContractFactory("ElixirRewarder")).deploy(nft.address, factory.address);
    factoryOwner = await (await ethers.getContractFactory("ElixirFactoryOwner")).deploy(wallet.address, factory.address, nft.address);
    await factory.setOwner(factoryOwner.address);
    await factoryOwner.grantRole(keccak256('REWARDER'), rewarder.address);
    await factoryOwner.setRewarder(rewarder.address);
  });

  it("bytecode size", async () => {
    expect(
      ((await nft.provider.getCode(nft.address)).length - 2) / 2
    ).to.matchSnapshot();
  });

  describe("#activateFarm", () => {
    it("set reward token for a pool", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);

      const farm = await rewarder.farms(poolAddress);
      expect(farm.manager).to.eq(constants.AddressZero);
      expect(farm.rewardToken).to.eq(tokens[2].address);
      expect(farm.rewardTokenChangeCounter).to.eq(0);
      expect(farm.deactivationTime).to.eq(0);
      expect(farm.active).to.eq(true);
      expect(farm.rewardDistributed).to.eq(0);
      expect(farm.rewardAdded).to.eq(0);
      expect(farm.distributionEndTime).to.eq(0);
    });
    it("cannot activate twice", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);
      await expect(rewarder.activateFarm(poolAddress, tokens[2].address, false)).to.be.revertedWith("FarmAlreadyActive()");
    });
    it("cannot reactivate with same token after deactivation", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);
      await rewarder.deactivateFarm(poolAddress);

      await network.provider.send("evm_increaseTime", [86400 * 14]); // 2 weeks need to pass

      await expect(rewarder.activateFarm(poolAddress, tokens[2].address, false)).to.be.revertedWith("NoOp()");
    });
    it("cannot reactivate before two weeks", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);
      await rewarder.deactivateFarm(poolAddress);

      await network.provider.send("evm_increaseTime", [86400 * 1]); // Just pass by one day

      await expect(rewarder.activateFarm(poolAddress, tokens[2].address, false)).to.be.revertedWith("TooEarlyToActivateFarm()");
    });
    it("reactivate with a new token - with revert", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);
      await tokens[2].approve(rewarder.address, constants.MaxUint256);
      const addRewardTx = await rewarder.addReward(poolAddress, 500, 1);

      await network.provider.send("evm_increaseTime", [86400]);

      const deactivateTx = await rewarder.deactivateFarm(poolAddress);
      await network.provider.send("evm_increaseTime", [86400 * 14]);

      const balanceBefore = await tokens[2].balanceOf(wallet.address);
      await rewarder.activateFarm(poolAddress, tokens[0].address, false);
      const balanceAfter = await tokens[2].balanceOf(wallet.address);
      expect(balanceAfter.sub(balanceBefore)).to.eq(500); // all unclaimed tokens are refunded

      const deactivateTxTimestamp = (await ethers.provider.getBlock(deactivateTx.blockNumber)).timestamp;
      const addRewardTx = (await ethers.provider.getBlock(addRewardTx.blockNumber)).timestamp;

      const farm = await rewarder.farms(poolAddress);
      expect(farm.manager).to.eq(constants.AddressZero);
      expect(farm.rewardToken).to.eq(tokens[0].address);
      expect(farm.rewardTokenChangeCounter).to.eq(1);
      expect(farm.deactivationTime).to.eq(deactivateTxTimestamp);
      expect(farm.active).to.eq(true);
      expect(farm.rewardDistributed).to.eq(0);
      expect(farm.rewardAdded).to.eq(0);
      expect(farm.distributionEndTime).to.eq(addRewardTx + 86400);
    });
    it("reactivate with a new token - no revert", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);
      await tokens[2].approve(rewarder.address, constants.MaxUint256);
      const addRewardTx = await rewarder.addReward(poolAddress, 500, 1);

      await network.provider.send("evm_increaseTime", [86400]);

      const deactivateTx = await rewarder.deactivateFarm(poolAddress);
      await network.provider.send("evm_increaseTime", [86400 * 14]);

      const balanceBefore = await tokens[2].balanceOf(wallet.address);
      await rewarder.activateFarm(poolAddress, tokens[0].address, true);
      const balanceAfter = await tokens[2].balanceOf(wallet.address);
      expect(balanceAfter.sub(balanceBefore)).to.eq(500); // all unclaimed tokens are refunded

      const deactivateTxTimestamp = (await ethers.provider.getBlock(deactivateTx.blockNumber)).timestamp;
      const addRewardTx = (await ethers.provider.getBlock(addRewardTx.blockNumber)).timestamp;

      const farm = await rewarder.farms(poolAddress);
      expect(farm.manager).to.eq(constants.AddressZero);
      expect(farm.rewardToken).to.eq(tokens[0].address);
      expect(farm.rewardTokenChangeCounter).to.eq(1);
      expect(farm.deactivationTime).to.eq(deactivateTxTimestamp);
      expect(farm.active).to.eq(true);
      expect(farm.rewardDistributed).to.eq(0);
      expect(farm.rewardAdded).to.eq(0);
      expect(farm.distributionEndTime).to.eq(addRewardTx + 86400);
    });
  });

  describe("#cancelDeactivation", () => {
    it("cannot cancel for an unset farm", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);

      await expect(rewarder.cancelDeactivation(poolAddress)).to.be.revertedWith("NoOp()");
    });
    it("cannot cancel deactivation on an active farm", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);

      await expect(rewarder.cancelDeactivation(poolAddress)).to.be.revertedWith("NoOp()");
    });
    it("cancel deactivation during deactivation", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);

      const deactivateTx = await rewarder.deactivateFarm(poolAddress);
      const deactivateTxTimestamp = (await ethers.provider.getBlock(deactivateTx.blockNumber)).timestamp;

      await rewarder.cancelDeactivation(poolAddress);

      const farm = await rewarder.farms(poolAddress);
      expect(farm.manager).to.eq(constants.AddressZero);
      expect(farm.rewardToken).to.eq(tokens[2].address);
      expect(farm.rewardTokenChangeCounter).to.eq(0);
      expect(farm.deactivationTime).to.eq(deactivateTxTimestamp);
      expect(farm.active).to.eq(true);
      expect(farm.rewardDistributed).to.eq(0);
      expect(farm.rewardAdded).to.eq(0);
      expect(farm.distributionEndTime).to.eq(0);
    });
  });

  describe("#addReward", () => {
    it("add reward to a farm", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);

      await tokens[2].approve(rewarder.address, constants.MaxUint256);

      await network.provider.send("evm_setNextBlockTimestamp", [1633850000]);
      await rewarder.addReward(poolAddress, 500, 1);

      const farm = await rewarder.farms(poolAddress);
      expect(farm.manager).to.eq(constants.AddressZero);
      expect(farm.rewardToken).to.eq(tokens[2].address);
      expect(farm.rewardTokenChangeCounter).to.eq(0);
      expect(farm.deactivationTime).to.eq(0);
      expect(farm.active).to.eq(true);
      expect(farm.rewardDistributed).to.eq(0);
      expect(farm.rewardAdded).to.eq(500);
      expect(farm.distributionEndTime).to.eq(1633850000 + 86400);
    });
    it("add reward to an ongoing farm", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);

      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallet.address,
        amount0Desired: 1000,
        amount1Desired: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1633850000,
      });

      await tokens[2].approve(rewarder.address, constants.MaxUint256);
      await network.provider.send("evm_setNextBlockTimestamp", [1633850000]);
      await rewarder.addReward(poolAddress, 500, 1);
      await network.provider.send("evm_increaseTime", [86400 / 2]);
      await rewarder.addReward(poolAddress, 500, 1);

      const farm = await rewarder.farms(poolAddress);
      expect(farm.manager).to.eq(constants.AddressZero);
      expect(farm.rewardToken).to.eq(tokens[2].address);
      expect(farm.rewardTokenChangeCounter).to.eq(0);
      expect(farm.deactivationTime).to.eq(0);
      expect(farm.active).to.eq(true);
      expect(farm.rewardDistributed).to.eq(0);
      expect(farm.rewardAdded).to.eq(1000);
      expect(farm.distributionEndTime).to.eq(1633850000 + 86400 / 2 + 86400);

      await network.provider.send("evm_increaseTime", [86400]);
      const balanceBefore = await tokens[2].balanceOf(wallet.address);
      await nft.claimReward(1, wallet.address);
      const balanceAfter = await tokens[2].balanceOf(wallet.address);
      expect(balanceAfter.sub(balanceBefore)).to.be.within(999, 1000); // 1 lost to precision
    });
  });

  describe("#claimReward", () => {
    it("single user claims all rewards", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);
      const pool = new ethers.Contract(poolAddress, IElixirPoolABI, wallet);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);

      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallet.address,
        amount0Desired: 1000,
        amount1Desired: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1633850000,
      });

      await tokens[2].approve(rewarder.address, constants.MaxUint256);
      await network.provider.send("evm_setNextBlockTimestamp", [1633850000]);
      await rewarder.addReward(poolAddress, 500, 1);

      const poolRewardSlot = await pool.rewardSlot();
      expect(poolRewardSlot.rewardRateEffectiveUntil).to.eq(1633850000 + 86400);
      expect(poolRewardSlot.rewardPerSecondX48).to.eq(BigNumber.from(500).mul(BigNumber.from(2).pow(48)).div(86400));

      await network.provider.send("evm_increaseTime", [86400]);
      await network.provider.send("evm_mine");

      const balanceBefore = await tokens[2].balanceOf(wallet.address);
      await nft.claimReward(1, wallet.address);
      const balanceAfter = await tokens[2].balanceOf(wallet.address);
      expect(balanceAfter.sub(balanceBefore)).to.be.within(499, 500); // 1 lost to precision
    });
    it("single user cannot double claim", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);
      const pool = new ethers.Contract(poolAddress, IElixirPoolABI, wallet);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);

      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallet.address,
        amount0Desired: 1000,
        amount1Desired: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1633850000,
      });

      await tokens[2].approve(rewarder.address, constants.MaxUint256);
      await rewarder.addReward(poolAddress, 500, 1);

      await network.provider.send("evm_increaseTime", [86400]);
      await network.provider.send("evm_mine");

      await nft.claimReward(1, wallet.address);

      const balanceBefore = await tokens[2].balanceOf(wallet.address);
      await nft.claimReward(1, wallet.address);
      const balanceAfter = await tokens[2].balanceOf(wallet.address);
      expect(balanceAfter.sub(balanceBefore)).to.eq(0); // cannot double claim
    });
    it("single user gets half the rewards when entering halfway", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);
      const pool = new ethers.Contract(poolAddress, IElixirPoolABI, wallet);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);

      await tokens[2].approve(rewarder.address, constants.MaxUint256);
      await rewarder.addReward(poolAddress, 500, 1);

      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallet.address,
        amount0Desired: 1000,
        amount1Desired: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1633850000,
      });

      const balanceBefore = await tokens[2].balanceOf(wallet.address);
      await network.provider.send("evm_increaseTime", [86400 / 2]);
      await nft.claimReward(1, wallet.address);
      const balanceAfter = await tokens[2].balanceOf(wallet.address);
      expect(balanceAfter.sub(balanceBefore)).to.be.within(249, 250); // there is loss to precision
    });
    it("single user gets half the rewards when claiming halfway", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);
      const pool = new ethers.Contract(poolAddress, IElixirPoolABI, wallet);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);

      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallet.address,
        amount0Desired: 1000,
        amount1Desired: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1633850000,
      });

      await tokens[2].approve(rewarder.address, constants.MaxUint256);
      await rewarder.addReward(poolAddress, 500, 1);

      const balanceBefore = await tokens[2].balanceOf(wallet.address);
      await network.provider.send("evm_increaseTime", [86400 / 2]);
      await nft.claimReward(1, wallet.address);
      const balanceAfter = await tokens[2].balanceOf(wallet.address);
      expect(balanceAfter.sub(balanceBefore)).to.be.within(249, 250);
    });
    it("single user cannot double claim halfway", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);
      const pool = new ethers.Contract(poolAddress, IElixirPoolABI, wallet);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);

      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallet.address,
        amount0Desired: 1000,
        amount1Desired: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1633850000,
      });

      await tokens[2].approve(rewarder.address, constants.MaxUint256);
      await rewarder.addReward(poolAddress, 500, 1);

      const balanceBefore = await tokens[2].balanceOf(wallet.address);
      await network.provider.send("evm_increaseTime", [86400 / 2]);
      await nft.claimReward(1, wallet.address);
      await nft.claimReward(1, wallet.address); // double claim, should have no effect
      const balanceAfter = await tokens[2].balanceOf(wallet.address);
      expect(balanceAfter.sub(balanceBefore)).to.be.within(249, 250);
    });
    it("single user gets nothing outside active range", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);
      const pool = new ethers.Contract(poolAddress, IElixirPoolABI, wallet);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);

      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: TICK_SPACINGS[FeeAmount.MEDIUM],
        tickUpper: TICK_SPACINGS[FeeAmount.MEDIUM] * 2,
        fee: FeeAmount.MEDIUM,
        recipient: wallet.address,
        amount0Desired: 1000,
        amount1Desired: 0,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1633850000,
      });

      await tokens[2].approve(rewarder.address, constants.MaxUint256);
      await rewarder.addReward(poolAddress, 500, 1);

      const balanceBefore = await tokens[2].balanceOf(wallet.address);
      await network.provider.send("evm_increaseTime", [86400]);
      await nft.claimReward(1, wallet.address);
      const balanceAfter = await tokens[2].balanceOf(wallet.address);
      expect(balanceAfter.sub(balanceBefore)).to.eq(0);
    });
    it("single user gets half when price moves to its range halfway", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);
      const pool = new ethers.Contract(poolAddress, IElixirPoolABI, wallet);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);

      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: TICK_SPACINGS[FeeAmount.MEDIUM],
        tickUpper: TICK_SPACINGS[FeeAmount.MEDIUM] * 2,
        fee: FeeAmount.MEDIUM,
        recipient: wallet.address,
        amount0Desired: 1000,
        amount1Desired: 0,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1633850000,
      });

      await tokens[2].approve(rewarder.address, constants.MaxUint256);
      await rewarder.addReward(poolAddress, 500, 1);

      await network.provider.send("evm_increaseTime", [86400 / 2]);

      // move the active range
      const swapAmount = 500;
      await tokens[1].approve(router.address, swapAmount);
      await router.exactInput({
        recipient: wallet.address,
        deadline: 1733850000,
        path: encodePath(
          [tokens[1].address, tokens[0].address],
          [FeeAmount.MEDIUM]
        ),
        amountIn: swapAmount,
        amountOutMinimum: 0,
      });

      await network.provider.send("evm_increaseTime", [86400 / 2]);

      const balanceBefore = await tokens[2].balanceOf(wallet.address);
      await nft.claimReward(1, wallet.address);
      const balanceAfter = await tokens[2].balanceOf(wallet.address);
      expect(balanceAfter.sub(balanceBefore)).to.be.within(249, 250);
    });
    it("two users claim half the rewards each", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);
      const pool = new ethers.Contract(poolAddress, IElixirPoolABI, wallet);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);

      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallet.address,
        amount0Desired: 1000,
        amount1Desired: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1633850000,
      });
      await nft.connect(other).mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: other.address,
        amount0Desired: 1000,
        amount1Desired: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1633850000,
      });

      await tokens[2].approve(rewarder.address, constants.MaxUint256);
      await rewarder.addReward(poolAddress, 500, 1);

      await network.provider.send("evm_increaseTime", [86400]);
      await network.provider.send("evm_mine");

      {
        const balanceBefore = await tokens[2].balanceOf(wallet.address);
        await nft.claimReward(1, wallet.address);
        const balanceAfter = await tokens[2].balanceOf(wallet.address);
        expect(balanceAfter.sub(balanceBefore)).to.be.within(249, 250); // 1 lost to precision
      }
      {
        const balanceBefore = await tokens[2].balanceOf(other.address);
        await nft.connect(other).claimReward(2, other.address);
        const balanceAfter = await tokens[2].balanceOf(other.address);
        expect(balanceAfter.sub(balanceBefore)).to.within(249, 250); // 1 lost to precision
      }
    });
    it("two users only in range claims all rewards", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);
      const pool = new ethers.Contract(poolAddress, IElixirPoolABI, wallet);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);

      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallet.address,
        amount0Desired: 1000,
        amount1Desired: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1633850000,
      });
      await nft.connect(other).mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: TICK_SPACINGS[FeeAmount.MEDIUM],
        tickUpper: TICK_SPACINGS[FeeAmount.MEDIUM] * 2,
        fee: FeeAmount.MEDIUM,
        recipient: other.address,
        amount0Desired: 1000,
        amount1Desired: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1633850000,
      });

      await tokens[2].approve(rewarder.address, constants.MaxUint256);
      await rewarder.addReward(poolAddress, 500, 1);

      await network.provider.send("evm_increaseTime", [86400]);
      await network.provider.send("evm_mine");

      {
        const balanceBefore = await tokens[2].balanceOf(wallet.address);
        await nft.claimReward(1, wallet.address);
        const balanceAfter = await tokens[2].balanceOf(wallet.address);
        expect(balanceAfter.sub(balanceBefore)).to.be.within(499, 500); // 1 lost to precision
      }
      {
        const balanceBefore = await tokens[2].balanceOf(other.address);
        await nft.connect(other).claimReward(2, other.address);
        const balanceAfter = await tokens[2].balanceOf(other.address);
        expect(balanceAfter.sub(balanceBefore)).to.eq(0);
      }
    });
    it("cannot claim for others", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);
      const pool = new ethers.Contract(poolAddress, IElixirPoolABI, wallet);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);

      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallet.address,
        amount0Desired: 1000,
        amount1Desired: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1633850000,
      });

      await tokens[2].approve(rewarder.address, constants.MaxUint256);
      await rewarder.addReward(poolAddress, 500, 1);

      await network.provider.send("evm_increaseTime", [86400]);
      await network.provider.send("evm_mine");

      {
        const balanceBefore = await tokens[2].balanceOf(other.address);
        await expect(nft.connect(other).claimReward(1, other.address)).to.be.revertedWith("Not approved");
        await expect(nft.connect(other).claimReward(1, wallet.address)).to.be.revertedWith("Not approved");
        const balanceAfter = await tokens[2].balanceOf(other.address);
        expect(balanceAfter.sub(balanceBefore)).to.be.eq(0);
      }
    });
    it("can claim to others", async () => {
      await nft.createAndInitializePoolIfNecessary(
        tokens[0].address,
        tokens[1].address,
        FeeAmount.MEDIUM,
        encodePriceSqrt(1, 1)
      );

      const poolAddress = await factory.getPool(tokens[0].address, tokens[1].address, FeeAmount.MEDIUM);
      const pool = new ethers.Contract(poolAddress, IElixirPoolABI, wallet);

      await rewarder.activateFarm(poolAddress, tokens[2].address, false);

      await nft.mint({
        token0: tokens[0].address,
        token1: tokens[1].address,
        tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
        fee: FeeAmount.MEDIUM,
        recipient: wallet.address,
        amount0Desired: 1000,
        amount1Desired: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: 1633850000,
      });

      await tokens[2].approve(rewarder.address, constants.MaxUint256);
      await rewarder.addReward(poolAddress, 500, 1);

      await network.provider.send("evm_increaseTime", [86400]);
      await network.provider.send("evm_mine");

      {
        const balanceBefore = await tokens[2].balanceOf(other.address);
        await nft.claimReward(1, other.address);
        const balanceAfter = await tokens[2].balanceOf(other.address);
        expect(balanceAfter.sub(balanceBefore)).to.be.be.within(499, 500);
      }
    });
  });
});

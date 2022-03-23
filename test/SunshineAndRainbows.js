// test/SunshineAndRainbows.js
// Load dependencies
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");
const chance = require("chance").Chance();

const DENOMINATOR = BigNumber.from("10000");
const ONE_DAY = BigNumber.from("86400");
const SUPPLY = ethers.utils.parseUnits("10000000", 18);
const ZERO_ADDRESS = ethers.constants.AddressZero;
const FUNDER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("FUNDER"));
const PRECISION = ethers.utils.parseUnits("1", 30);

function getRewards(duration) {
  return SUPPLY.div(ONE_DAY.mul("100")).mul(duration);
}

function updateRewardVariables(rewards, stakingDuration, sinceInit) {
  var numerator1 = rewards.mul(PRECISION).mul(sinceInit);
  var idealPosition = numerator1.div(stakingDuration);
  if (!(numerator1.mod(stakingDuration).eq("0"))) {
    idealPosition = idealPosition.add("1");
  }

  var numerator2 = rewards.mul(PRECISION);
  var rewardsPerStakingDuration = numerator2.div(stakingDuration);
  if (!(numerator2.mod(stakingDuration).eq("0"))) {
    rewardsPerStakingDuration = rewardsPerStakingDuration.add("1");
  }

  return [idealPosition, rewardsPerStakingDuration];
}

// Start test block
describe.only("SunshineAndRainbows.sol", function () {
  before(async function () {
    // Get all signers
    this.signers = await ethers.getSigners();
    this.admin = this.signers[0];
    this.unauthorized = this.signers[1];

    // get contract factories
    this.Png = await ethers.getContractFactory("Png");
    this.Sunshine = await ethers.getContractFactory("SunshineAndRainbows");
    this.Regulator = await ethers.getContractFactory("RewardRegulatorFundable");
  });

  beforeEach(async function () {
    this.rewardToken = await this.Png.deploy(
      SUPPLY,
      SUPPLY,
      "REWARD",
      "Reward Token"
    );
    await this.rewardToken.deployed();

    this.stakingToken = await this.Png.deploy(
      SUPPLY,
      SUPPLY,
      "STAKING",
      "Staking Token"
    );
    await this.stakingToken.deployed();

    this.regulator = await this.Regulator.deploy(this.rewardToken.address);
    await this.regulator.deployed();

    this.sunshine = await this.Sunshine.deploy(
      this.stakingToken.address,
      this.regulator.address
    );
    await this.sunshine.deployed();

    await this.sunshine.resume();
    await this.rewardToken.transfer(this.regulator.address, SUPPLY);
    await this.stakingToken.approve(this.sunshine.address, SUPPLY);

    await this.regulator.grantRole(FUNDER_ROLE, this.admin.address);
    await this.regulator.setRecipients([this.sunshine.address], ["1"]);
    await this.regulator.setRewardsDuration(ONE_DAY.mul(100));
    await this.regulator.notifyRewardAmount(SUPPLY);

    var blockNumber = await ethers.provider.getBlockNumber();
    this.notifyRewardTime = (
      await ethers.provider.getBlock(blockNumber)
    ).timestamp;
  });

  // Test cases

  //////////////////////////////
  //     Constructor
  //////////////////////////////
  describe("Constructor", function () {
    it("arg 1: stakingToken", async function () {
      expect(await this.sunshine.stakingToken()).to.equal(
        this.stakingToken.address
      );
    });

    it("arg 2: rewardRegulator", async function () {
      expect(await this.sunshine.rewardRegulator()).to.equal(
        this.regulator.address
      );
    });

    it("default: totalSupply", async function () {
      expect(await this.sunshine.totalSupply()).to.equal("0");
    });

    it("default: rewardToken", async function () {
      expect(await this.sunshine.rewardToken()).to.equal(
        this.rewardToken.address
      );
    });

    it("default: positionsLength", async function () {
      expect(await this.sunshine.positionsLength()).to.equal("0");
    });

    it("default: initTime", async function () {
      expect(await this.sunshine.initTime()).to.equal("0");
    });

    it("default: sumOfEntryTimes", async function () {
      expect(await this.sunshine.sumOfEntryTimes()).to.equal("0");
    });
  });

  //////////////////////////////
  //     stake
  //////////////////////////////
  describe("stake", function () {
    it("stakes once for sender", async function () {
      expect(await this.sunshine.stake(SUPPLY, this.admin.address)).to.emit(
        this.sunshine,
        "Staked"
      );

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY
      );
      expect(await this.sunshine.totalSupply()).to.equal(SUPPLY);
      expect(await this.sunshine.positionsLength()).to.equal("1");
      expect(await this.sunshine.initTime()).to.equal(initTime);

      var position = await this.sunshine.positions("1");

      expect(position.reward).to.equal("0");
      expect(position.balance).to.equal(SUPPLY);
      expect(position.lastUpdate).to.equal(initTime);
      expect(position.rewardsPerStakingDuration).to.equal("0");
      expect(position.idealPosition).to.equal("0");
      expect(position.owner).to.equal(this.admin.address);
    });

    it("stakes once for another account", async function () {
      expect(
        await this.sunshine.stake(SUPPLY, this.unauthorized.address)
      ).to.emit(this.sunshine, "Staked");

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY
      );
      expect(await this.sunshine.totalSupply()).to.equal(SUPPLY);
      expect(await this.sunshine.positionsLength()).to.equal("1");
      expect(await this.sunshine.initTime()).to.equal(initTime);

      var position = await this.sunshine.positions("1");

      expect(position.reward).to.equal("0");
      expect(position.balance).to.equal(SUPPLY);
      expect(position.lastUpdate).to.equal(initTime);
      expect(position.rewardsPerStakingDuration).to.equal("0");
      expect(position.idealPosition).to.equal("0");
      expect(position.owner).to.equal(this.unauthorized.address);
    });

    it("cannot stake zero", async function () {
      await expect(
        this.sunshine.stake("0", this.admin.address)
      ).to.be.revertedWith("SAR::_stake: zero amount");
    });

    it("cannot stake to zero address", async function () {
      await expect(
        this.sunshine.stake(SUPPLY, ZERO_ADDRESS)
      ).to.be.revertedWith("SAR::_createPosition: bad recipient");
    });

    it("stake twice to sender and update reward variables", async function () {
      expect(
        await this.sunshine.stake(SUPPLY.div("2"), this.admin.address)
      ).to.emit(this.sunshine, "Staked");

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      expect(
        await this.sunshine.stake(SUPPLY.div("2"), this.admin.address)
      ).to.emit(this.sunshine, "Staked");

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY
      );
      expect(await this.sunshine.totalSupply()).to.equal(SUPPLY);
      expect(await this.sunshine.positionsLength()).to.equal("2");
      expect(await this.sunshine.initTime()).to.equal(initTime);

      var interval = lastUpdate - initTime; // also the stakingDuration

      var [idealPosition, rewardsPerStakingDuration] = updateRewardVariables(
        getRewards(lastUpdate - this.notifyRewardTime),
        SUPPLY.div("2").mul(interval),
        interval
      );

      var position = await this.sunshine.positions("2");

      expect(position.reward).to.equal("0");
      expect(position.balance).to.equal(SUPPLY.div("2"));
      expect(position.lastUpdate).to.equal(lastUpdate);
      expect(position.owner).to.equal(this.admin.address);
      expect(position.idealPosition).to.equal(idealPosition);
      expect(position.rewardsPerStakingDuration).to.equal(
        rewardsPerStakingDuration
      );
    });
  });

  //////////////////////////////
  //     withdraw
  //////////////////////////////
  describe("withdraw", function () {
    it("withdraws after staking one for sender", async function () {
      expect(await this.sunshine.stake(SUPPLY, this.admin.address)).to.emit(
        this.sunshine,
        "Staked"
      );

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      expect(await this.sunshine.withdraw("1", SUPPLY)).to.emit(
        this.sunshine,
        "Withdrawn"
      );

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      expect(await this.stakingToken.balanceOf(this.admin.address)).to.equal(
        SUPPLY
      );
      expect(await this.sunshine.totalSupply()).to.equal("0");
      expect(await this.sunshine.positionsLength()).to.equal("1");
      expect(await this.sunshine.initTime()).to.equal(initTime);

      var interval = lastUpdate - initTime; // also the stakingDuration
      var reward = getRewards(lastUpdate - this.notifyRewardTime);

      var [idealPosition, rewardsPerStakingDuration] = updateRewardVariables(
        reward,
        SUPPLY.mul(interval),
        interval
      );

      var position = await this.sunshine.positions("1");

      expect(position.reward).to.equal(reward);
      expect(position.balance).to.equal("0");
      expect(position.lastUpdate).to.equal(lastUpdate);
      expect(position.owner).to.equal(this.admin.address);
      expect(position.idealPosition).to.equal(idealPosition);
      expect(position.rewardsPerStakingDuration).to.equal(
        rewardsPerStakingDuration
      );
    });

    it("cannot withdraw zero", async function () {
      expect(await this.sunshine.stake(SUPPLY, this.admin.address)).to.emit(
        this.sunshine,
        "Staked"
      );

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.withdraw("1", "0")).to.be.revertedWith(
        "SAR::_withdraw: zero amount"
      );
    });

    it("cannot withdraw more than the balance", async function () {
      expect(await this.sunshine.stake(SUPPLY, this.admin.address)).to.emit(
        this.sunshine,
        "Staked"
      );

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(
        this.sunshine.withdraw("1", SUPPLY.add("1"))
      ).to.be.revertedWith("SAR::_withdraw: low balance");
    });

    it("cannot withdraw from others’ position", async function () {
      expect(await this.sunshine.stake(SUPPLY, this.admin.address)).to.emit(
        this.sunshine,
        "Staked"
      );

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      sunshine = await this.sunshine.connect(this.unauthorized);

      await expect(sunshine.withdraw("1", SUPPLY)).to.be.revertedWith(
        "SAR::_withdraw: unauthorized"
      );
    });
  });

  //////////////////////////////
  //     harvest
  //////////////////////////////
  describe("harvest", function () {
    it("harvests after staking one to sender", async function () {
      expect(await this.sunshine.stake(SUPPLY, this.admin.address)).to.emit(
        this.sunshine,
        "Staked"
      );

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      expect(await this.sunshine.harvest("1")).to.emit(
        this.sunshine,
        "Harvested"
      );

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY
      );
      expect(await this.sunshine.totalSupply()).to.equal(SUPPLY);
      expect(await this.sunshine.positionsLength()).to.equal("1");
      expect(await this.sunshine.initTime()).to.equal(initTime);

      var interval = lastUpdate - initTime; // also the stakingDuration
      var reward = getRewards(lastUpdate - this.notifyRewardTime);

      var [idealPosition, rewardsPerStakingDuration] = updateRewardVariables(
        reward,
        SUPPLY.mul(interval),
        interval
      );

      var position = await this.sunshine.positions("1");
      var actualReward = await this.rewardToken.balanceOf(this.admin.address);

      expect(position.reward).to.equal("0");
      expect(position.balance).to.equal(SUPPLY);
      expect(position.lastUpdate).to.equal(lastUpdate);
      expect(position.owner).to.equal(this.admin.address);
      expect(position.idealPosition).to.equal(idealPosition);
      expect(position.rewardsPerStakingDuration).to.equal(
        rewardsPerStakingDuration
      );

      expect(actualReward).to.equal(reward);
    });

    it("cannot harvest from others’ position", async function () {
      expect(await this.sunshine.stake(SUPPLY, this.admin.address)).to.emit(
        this.sunshine,
        "Staked"
      );

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      sunshine = await this.sunshine.connect(this.unauthorized);

      await expect(sunshine.harvest("1")).to.be.revertedWith(
        "SAR::_harvest: unauthorized"
      );
    });

    it("cannot harvest zero", async function () {
      expect(await this.sunshine.stake(SUPPLY, this.admin.address)).to.emit(
        this.sunshine,
        "Staked"
      );

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      expect(await this.sunshine.withdraw("1", SUPPLY)).to.emit(
        this.sunshine,
        "Withdrawn"
      );

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      expect(await this.sunshine.harvest("1")).to.emit(
        this.sunshine,
        "Harvested"
      );

      await expect(this.sunshine.harvest("1")).to.be.revertedWith(
        "SAR::harvest: no reward"
      );
    });
  });

  //////////////////////////////
  //     massExit
  //////////////////////////////
  describe("massExit", function () {
    it("exits one position", async function () {
      expect(await this.sunshine.stake(SUPPLY, this.admin.address)).to.emit(
        this.sunshine,
        "Staked"
      );
      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      expect(await this.sunshine.massExit([1])).to.emit(
        this.sunshine,
        "Withdrawn"
      );

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      expect(await this.stakingToken.balanceOf(this.admin.address)).to.equal(
        SUPPLY
      );
      expect(await this.sunshine.totalSupply()).to.equal("0");
      expect(await this.sunshine.positionsLength()).to.equal("1");
      expect(await this.sunshine.initTime()).to.equal(initTime);

      var interval = lastUpdate - initTime; // also the stakingDuration
      var reward = getRewards(lastUpdate - this.notifyRewardTime);

      var [idealPosition, rewardsPerStakingDuration] = updateRewardVariables(
        reward,
        SUPPLY.mul(interval),
        interval
      );

      var position = await this.sunshine.positions("1");
      var actualReward = await this.rewardToken.balanceOf(this.admin.address);

      expect(position.reward).to.equal("0");
      expect(position.balance).to.equal("0");
      expect(position.lastUpdate).to.equal(lastUpdate);
      expect(position.owner).to.equal(this.admin.address);
      expect(position.idealPosition).to.equal(idealPosition);
      expect(position.rewardsPerStakingDuration).to.equal(
        rewardsPerStakingDuration
      );

      expect(actualReward).to.equal(reward);
    });

    it("exits 10 positions", async function () {
      var arr = [];

      for (let i = 0; i < 10; i++) {
        expect(await this.sunshine.stake(SUPPLY.div("10"), this.admin.address)).to.emit(
          this.sunshine,
          "Staked"
        );
        var bal = await this.stakingToken.balanceOf(this.admin.address);
        await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
        arr.push(i + 1);
      };

      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY
      );

      expect(await this.sunshine.massExit(arr)).to.emit(
        this.sunshine,
        "Withdrawn"
      );

      var blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      expect(await this.stakingToken.balanceOf(this.admin.address)).to.equal(
        SUPPLY
      );
      expect(await this.sunshine.totalSupply()).to.equal("0");
      expect(await this.sunshine.positionsLength()).to.equal("10");
    });
  });

  //////////////////////////////
  //     Simulation
  //////////////////////////////
  describe.skip("Simulation", function () {});
});

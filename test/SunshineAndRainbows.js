// test/SunshineAndRainbows.js
// Load dependencies
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");

const ONE_DAY = BigNumber.from("86400");
const SUPPLY = ethers.utils.parseUnits("10000000", 18);
const ZERO_ADDRESS = ethers.constants.AddressZero;
const FUNDER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("FUNDER"));
const PRECISION = BigNumber.from("2").pow("256");
const UINT256_MAX = ethers.constants.MaxUint256;

function getRewards(duration) {
  return SUPPLY.div(ONE_DAY.mul("100")).mul(duration);
}

function updateRewardVariables(rewards, stakingDuration, sinceInit) {
  var idealPosition = rewards
    .mul(sinceInit)
    .mul(PRECISION.div(stakingDuration));
  var rewardsPerStakingDuration = rewards.mul(PRECISION.div(stakingDuration));

  return [idealPosition, rewardsPerStakingDuration];
}

function generateRecipients(recipientsLength) {
  let recipients = [];
  let allocations = [];

  for (let i = 0; i < recipientsLength; i++) {
    let account = ethers.Wallet.createRandom();
    recipients.push(account.address);
    allocations.push(BigNumber.from("100"));
  }

  return [recipients, allocations];
}

/*********************
  ____    _    ____
 / ___|  / \  |  _ \
 \___ \ / _ \ | |_) |
  ___) / ___ \|  _ <
 |____/_/   \_\_| \_\

**********************/
describe("SunshineAndRainbows.sol", function () {
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

    it("default: initTime", async function () {
      expect(await this.sunshine.initTime()).to.equal("0");
    });

    it("default: sumOfEntryTimes", async function () {
      expect(await this.sunshine.sumOfEntryTimes()).to.equal("0");
    });

    it("deploy: zero address staking token", async function () {
      await expect(
        this.Sunshine.deploy(ZERO_ADDRESS, this.regulator.address)
      ).to.be.revertedWith("SAR::Constructor: zero address");
    });

    it("deploy: zero address reward regulator", async function () {
      await expect(
        this.Sunshine.deploy(this.stakingToken.address, ZERO_ADDRESS)
      ).to.be.revertedWith("SAR::Constructor: zero address");
    });
  });

  //////////////////////////////
  //     open
  //////////////////////////////
  describe("open", function () {
    it("stakes once", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY
      );
      expect(await this.sunshine.totalSupply()).to.equal(SUPPLY);
      expect(await this.sunshine.initTime()).to.equal(initTime);
      expect(await this.sunshine.sumOfEntryTimes()).to.equal(
        SUPPLY.mul(initTime)
      );

      var position = await this.sunshine.positions("0");

      expect(position.balance).to.equal(SUPPLY);
      expect(position.lastUpdate).to.equal(initTime);
      expect(position.rewardsPerStakingDuration.r0).to.equal("0");
      expect(position.rewardsPerStakingDuration.r1).to.equal("0");
      expect(position.idealPosition.r0).to.equal("0");
      expect(position.idealPosition.r1).to.equal("0");
      expect(position.owner).to.equal(this.admin.address);
    });

    it("cannot stake zero", async function () {
      await expect(this.sunshine.open("0")).to.be.revertedWith(
        "SAR::_open: zero amount"
      );
    });

    it("stake twice and update reward variables", async function () {
      await expect(this.sunshine.open(SUPPLY.div("2"))).to.emit(
        this.sunshine,
        "Opened"
      );

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.open(SUPPLY.div("2"))).to.emit(
        this.sunshine,
        "Opened"
      );

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var pending = await this.sunshine.pendingRewards(["0"]);
      expect(pending[0]).to.be.within(reward.sub("2"), reward);

      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY
      );
      expect(await this.rewardToken.balanceOf(this.sunshine.address)).to.equal(
        reward
      );
      expect(await this.sunshine.totalSupply()).to.equal(SUPPLY);
      expect(await this.sunshine.sumOfEntryTimes()).to.equal(
        SUPPLY.div("2").mul(initTime + lastUpdate)
      );
      expect(await this.sunshine.initTime()).to.equal(initTime);

      var interval = lastUpdate - initTime; // also the stakingDuration

      var [idealPosition, rewardsPerStakingDuration] = updateRewardVariables(
        getRewards(lastUpdate - this.notifyRewardTime),
        SUPPLY.div("2").mul(interval),
        interval
      );

      var position = await this.sunshine.positions("1");

      expect(position.balance).to.equal(SUPPLY.div("2"));
      expect(position.lastUpdate).to.equal(lastUpdate);
      expect(position.owner).to.equal(this.admin.address);
      expect(position.idealPosition.r0).to.equal(idealPosition);
      expect(position.idealPosition.r1).to.equal("0");
      expect(position.rewardsPerStakingDuration.r0).to.equal(
        rewardsPerStakingDuration
      );
      expect(position.rewardsPerStakingDuration.r1).to.equal("0");
    });
  });

  //////////////////////////////
  //     close
  //////////////////////////////
  describe("close", function () {
    it("closes after staking", async function () {
      await expect(this.sunshine.open(SUPPLY.div("2"))).to.emit(
        this.sunshine,
        "Opened"
      );

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.close("0")).to.emit(this.sunshine, "Closed");

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;
      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var distributed = await this.rewardToken.balanceOf(this.admin.address);

      var pending = await this.sunshine.pendingRewards(["0"]);
      expect(pending[0]).to.equal("0");

      expect(await this.stakingToken.balanceOf(this.admin.address)).to.equal(
        SUPPLY
      );
      expect(distributed).to.be.within(reward.sub("2"), reward);

      expect(
        await this.rewardToken.balanceOf(this.sunshine.address)
      ).to.be.within("0", "2");
      expect(await this.sunshine.totalSupply()).to.equal("0");
      expect(await this.sunshine.sumOfEntryTimes()).to.equal("0");
      expect(await this.sunshine.initTime()).to.equal(initTime);

      var position = await this.sunshine.positions("0");

      expect(position.balance).to.equal("0"); // only balance is updated
      expect(position.lastUpdate).to.equal(initTime); // no need to update
      expect(position.owner).to.equal(this.admin.address);
      expect(position.idealPosition.r0).to.equal("0");
      expect(position.idealPosition.r1).to.equal("0");
      expect(position.rewardsPerStakingDuration.r0).to.equal("0");
      expect(position.rewardsPerStakingDuration.r1).to.equal("0");
    });

    it("cannot do anything with closed position", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");
      await expect(this.sunshine.close("0")).to.emit(this.sunshine, "Closed");
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(this.sunshine.harvest("0")).to.be.revertedWith(
        "SAR::_harvest: zero reward"
      );
      await expect(
        this.sunshine.withdraw("0", SUPPLY.div("2"))
      ).to.be.revertedWith("SAR::_withdraw: use `close()`");
      await expect(this.sunshine.close("0")).to.be.revertedWith(
        "SAR::_close: zero amount"
      );
      await expect(this.sunshine.multiClose(["0"])).to.be.revertedWith(
        "SAR::_close: zero amount"
      );
    });

    it("cannot close others’ position", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      var sunshine = await this.sunshine.connect(this.unauthorized);
      await expect(sunshine.close("0")).to.be.revertedWith(
        "SAR::_close: unauthorized"
      );
    });
  });

  //////////////////////////////
  //     harvest
  //////////////////////////////
  describe("harvest", function () {
    it("harvests after staking", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.harvest("0")).to.emit(
        this.sunshine,
        "Harvested"
      );

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      var interval = lastUpdate - initTime; // also the stakingDuration
      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var distributed = await this.rewardToken.balanceOf(this.admin.address);

      expect(await this.stakingToken.balanceOf(this.admin.address)).to.equal(
        "0"
      );
      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY
      );
      expect(distributed).to.be.within(reward.sub("2"), reward);

      var pending = await this.sunshine.pendingRewards(["0"]);
      expect(pending[0]).to.equal("0");

      expect(
        await this.rewardToken.balanceOf(this.sunshine.address)
      ).to.be.within("0", "2");
      expect(await this.sunshine.totalSupply()).to.equal(SUPPLY);
      expect(await this.sunshine.sumOfEntryTimes()).to.equal(
        SUPPLY.mul(lastUpdate)
      );
      expect(await this.sunshine.initTime()).to.equal(initTime);

      var [idealPosition, rewardsPerStakingDuration] = updateRewardVariables(
        reward,
        SUPPLY.mul(interval),
        interval
      );

      var position = await this.sunshine.positions("0");

      expect(position.balance).to.equal(SUPPLY);
      expect(position.lastUpdate).to.equal(lastUpdate);
      expect(position.owner).to.equal(this.admin.address);
      expect(position.idealPosition.r0).to.equal(idealPosition);
      expect(position.idealPosition.r1).to.equal("0");
      expect(position.rewardsPerStakingDuration.r0).to.equal(
        rewardsPerStakingDuration
      );
      expect(position.rewardsPerStakingDuration.r1).to.equal("0");
    });

    it("cannot harvest from others’ position", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      var sunshine = await this.sunshine.connect(this.unauthorized);

      await expect(sunshine.harvest("0")).to.be.revertedWith(
        "SAR::_harvest: unauthorized"
      );
    });

    it("cannot harvest zero", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(this.sunshine.close("0")).to.emit(this.sunshine, "Closed");

      await expect(this.sunshine.harvest("0")).to.be.revertedWith(
        "SAR::_harvest: zero reward"
      );
    });
  });

  //////////////////////////////
  //     multiClose
  //////////////////////////////
  describe("multiClose", function () {
    it("exits 40 positions", async function () {
      var arr = [];
      var len = 40;

      for (let i = 0; i < len; i++) {
        await expect(this.sunshine.open(SUPPLY.div(len))).to.emit(
          this.sunshine,
          "Opened"
        );
        await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
        arr.push(i);
      }

      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY
      );

      var rates = await this.sunshine.rewardRates(arr);
      var previousRate;
      for (let i = 0; i < len; i++) {
        if (i != 0) expect(rates[i]).to.be.below(previousRate);
        previousRate = rates[i];
      }

      await ethers.provider.send("evm_increaseTime", [
        ONE_DAY.mul("40").toNumber(),
      ]);
      await network.provider.send("evm_mine");

      var positions = await this.sunshine.positionsOf(this.admin.address);
      for (let i = 0; i < len; i++) {
        expect(positions[i].toNumber()).to.equal(arr[i]);
      }

      expect(await this.sunshine.multiClose(arr)).to.emit(
        this.sunshine,
        "Closed"
      );

      var blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var distributed = await this.rewardToken.balanceOf(this.admin.address);

      expect(await this.stakingToken.balanceOf(this.admin.address)).to.equal(
        SUPPLY
      );
      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        "0"
      );
      expect(distributed).to.be.within(reward.sub("80"), reward);

      expect(
        await this.rewardToken.balanceOf(this.sunshine.address)
      ).to.be.within("0", "80");

      expect(await this.sunshine.totalSupply()).to.equal("0");
      expect(await this.sunshine.sumOfEntryTimes()).to.equal("0");
    });
  });

  //////////////////////////////
  //     withdraw
  //////////////////////////////
  describe("withdraw", function () {
    it("withdraws half after staking", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.withdraw("0", SUPPLY.div("2"))).to.emit(
        this.sunshine,
        "Withdrawn"
      );

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;
      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var distributed = await this.rewardToken.balanceOf(this.admin.address);

      expect(await this.stakingToken.balanceOf(this.admin.address)).to.equal(
        SUPPLY.div("2")
      );
      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY.div("2")
      );
      expect(distributed).to.be.within(
        reward.div("2").sub("2"),
        reward.div("2")
      );

      var remaining = reward.sub(distributed); // remaining dust in the contract

      expect(
        await this.rewardToken.balanceOf(this.sunshine.address)
      ).to.be.within(remaining.sub("2"), remaining.add("2"));
      expect(await this.sunshine.totalSupply()).to.equal(SUPPLY.div("2"));
      expect(await this.sunshine.sumOfEntryTimes()).to.equal(
        SUPPLY.div("2").mul(initTime)
      );
      expect(await this.sunshine.initTime()).to.equal(initTime);

      var pending = await this.sunshine.pendingRewards(["0"]);
      expect(pending[0]).to.be.within(remaining.sub("2"), remaining);

      var position = await this.sunshine.positions("0");

      expect(position.balance).to.equal(SUPPLY.div("2"));
      expect(position.lastUpdate).to.equal(initTime);
      expect(position.owner).to.equal(this.admin.address);
      expect(position.idealPosition.r0).to.equal("0");
      expect(position.idealPosition.r1).to.equal("0");
      expect(position.rewardsPerStakingDuration.r0).to.equal("0");
      expect(position.rewardsPerStakingDuration.r1).to.equal("0");
    });

    it("cannot withdraw from others’ position", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      sunshine = await this.sunshine.connect(this.unauthorized);

      await expect(sunshine.withdraw("0", SUPPLY.div("2"))).to.be.revertedWith(
        "SAR::_withdraw: unauthorized"
      );
    });

    it("cannot withdraw zero", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.withdraw("0", "0")).to.be.revertedWith(
        "SAR::_withdraw: zero amount"
      );
    });

    it("cannot withdraw more or equal to balance", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.withdraw("0", SUPPLY)).to.be.revertedWith(
        "SAR::_withdraw: use `close()`"
      );
    });
  });

  //////////////////////////////
  //     multiHarvest
  //////////////////////////////
  describe("multiHarvest", function () {
    it("harvests 10 positions", async function () {
      var arr = [];
      var blockNumber;
      var initTime;
      var len = 10;
      var sumOfEntryTimes;

      for (let i = 0; i < len; i++) {
        await expect(this.sunshine.open(SUPPLY.div(len))).to.emit(
          this.sunshine,
          "Opened"
        );
        blockNumber = await ethers.provider.getBlockNumber();
        if (i == 0) {
          initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;
          sumOfEntryTimes = SUPPLY.div(len).mul(initTime);
        } else {
          var timestamp = (await ethers.provider.getBlock(blockNumber))
            .timestamp;
          sumOfEntryTimes = sumOfEntryTimes.add(SUPPLY.div(len).mul(timestamp));
        }
        await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
        arr.push(i);
      }

      expect(await this.sunshine.sumOfEntryTimes()).to.equal(sumOfEntryTimes);
      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY
      );

      var rates = await this.sunshine.rewardRates(arr);
      var previousRate;
      for (let i = 0; i < len; i++) {
        if (i != 0) expect(rates[i]).to.be.below(previousRate);
        previousRate = rates[i];
      }

      await ethers.provider.send("evm_increaseTime", [
        ONE_DAY.mul(len).toNumber(),
      ]);
      await network.provider.send("evm_mine");

      var positions = await this.sunshine.positionsOf(this.admin.address);
      for (let i = 0; i < len; i++) {
        expect(positions[i].toNumber()).to.equal(arr[i]);
      }

      expect(await this.sunshine.multiHarvest(arr)).to.emit(
        this.sunshine,
        "Harvested"
      );

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;
      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var distributed = await this.rewardToken.balanceOf(this.admin.address);

      expect(await this.stakingToken.balanceOf(this.admin.address)).to.equal(
        "0"
      );
      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY
      );
      expect(distributed).to.be.within(reward.sub("20"), reward);

      expect(
        await this.rewardToken.balanceOf(this.sunshine.address)
      ).to.be.within("0", "20");

      expect(await this.sunshine.totalSupply()).to.equal(SUPPLY);
      expect(await this.sunshine.sumOfEntryTimes()).to.equal(
        SUPPLY.mul(lastUpdate)
      );
    });
  });

  //////////////////////////////
  //     multiWithdraw
  //////////////////////////////
  describe("multiWithdraw", function () {
    it("withdraws 10 positions", async function () {
      var arr = [];
      var blockNumber;
      var initTime;
      var len = 10;
      var sumOfEntryTimes;

      for (let i = 0; i < len; i++) {
        await expect(this.sunshine.open(SUPPLY.div(len))).to.emit(
          this.sunshine,
          "Opened"
        );
        blockNumber = await ethers.provider.getBlockNumber();
        if (i == 0) {
          initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;
          sumOfEntryTimes = SUPPLY.div(len).mul(initTime);
        } else {
          var timestamp = (await ethers.provider.getBlock(blockNumber))
            .timestamp;
          sumOfEntryTimes = sumOfEntryTimes.add(SUPPLY.div(len).mul(timestamp));
        }
        await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
        arr.push(i);
      }

      expect(await this.sunshine.sumOfEntryTimes()).to.equal(sumOfEntryTimes);
      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY
      );

      var rates = await this.sunshine.rewardRates(arr);
      var previousRate;
      for (let i = 0; i < len; i++) {
        if (i != 0) expect(rates[i]).to.be.below(previousRate);
        previousRate = rates[i];
      }

      await ethers.provider.send("evm_increaseTime", [
        ONE_DAY.mul(len).toNumber(),
      ]);
      await network.provider.send("evm_mine");

      var positions = await this.sunshine.positionsOf(this.admin.address);
      for (let i = 0; i < len; i++) {
        expect(positions[i].toNumber()).to.equal(arr[i]);
      }
      arr.shift();

      // close all except first position. withdraw half of first position
      expect(
        await this.sunshine.multiWithdraw(arr, "0", SUPPLY.div(len * 2))
      ).to.emit(this.sunshine, "Closed");

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;
      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var distributed = await this.rewardToken.balanceOf(this.admin.address);
      var pending = (await this.sunshine.pendingRewards(["0"]))[0];

      expect(await this.stakingToken.balanceOf(this.admin.address)).to.equal(
        SUPPLY.sub(SUPPLY.div(len * 2))
      );
      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY.div(len * 2)
      );
      expect(distributed.add(pending)).to.be.within(reward.sub("20"), reward);

      expect(
        await this.rewardToken.balanceOf(this.sunshine.address)
      ).to.be.within(pending, pending.add("20"));

      expect(await this.sunshine.totalSupply()).to.equal(SUPPLY.div(len * 2));
      expect(await this.sunshine.sumOfEntryTimes()).to.equal(
        SUPPLY.div(len * 2).mul(initTime)
      );
    });
  });

  //////////////////////////////
  //     rewardRates
  //////////////////////////////
  describe("rewardRates", function () {
    it("reverts on zero staking duration", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");
      await expect(this.sunshine.close("0")).to.emit(this.sunshine, "Closed");
      await expect(this.sunshine.rewardRates(["0"])).to.be.revertedWith(
        "SAR::rewardRates: zero stake duration"
      );
    });
    // a loose check on reward rates is made in multiClose
  });

  //////////////////////////////
  //     arbitrary actions
  //////////////////////////////
  describe("arbitrary actions", function () {
    it("stake + withdraw x2 + stake + multiClose", async function () {
      await expect(this.sunshine.open(SUPPLY.div("2"))).to.emit(
        this.sunshine,
        "Opened"
      );
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.withdraw("0", SUPPLY.div("4"))).to.emit(
        this.sunshine,
        "Withdrawn"
      );
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(
        this.sunshine.withdraw("0", SUPPLY.div("4").sub("1"))
      ).to.emit(this.sunshine, "Withdrawn");
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.open(SUPPLY.div("2"))).to.emit(
        this.sunshine,
        "Opened"
      );
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.multiClose(["0", "1"])).to.emit(
        this.sunshine,
        "Closed"
      );

      var blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;
      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var distributed = await this.rewardToken.balanceOf(this.admin.address);

      expect(await this.stakingToken.balanceOf(this.admin.address)).to.equal(
        SUPPLY
      );
      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        "0"
      );
      expect(distributed).to.be.within(reward.sub("10"), reward);

      var remaining = reward.sub(distributed); // remaining dust in the contract

      expect(await this.rewardToken.balanceOf(this.sunshine.address)).to.equal(
        remaining
      );
      expect(await this.sunshine.totalSupply()).to.equal("0");
      expect(await this.sunshine.sumOfEntryTimes()).to.equal("0");
    });

    it("stake x 4 + harvest x 2 + close + multiClose", async function () {
      for (let i = 0; i < 4; i++) {
        await expect(this.sunshine.open(SUPPLY.div("4"))).to.emit(
          this.sunshine,
          "Opened"
        );
      }

      for (let i = 0; i < 2; i++) {
        await expect(this.sunshine.harvest("0")).to.emit(
          this.sunshine,
          "Harvested"
        );
        await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      }

      await expect(this.sunshine.close("2")).to.emit(this.sunshine, "Closed");
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.multiClose(["0", "1", "3"])).to.emit(
        this.sunshine,
        "Closed"
      );

      var blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;
      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var distributed = await this.rewardToken.balanceOf(this.admin.address);

      expect(await this.stakingToken.balanceOf(this.admin.address)).to.equal(
        SUPPLY
      );
      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        "0"
      );
      expect(distributed).to.be.within(reward.sub("10"), reward);

      expect(
        await this.rewardToken.balanceOf(this.sunshine.address)
      ).to.be.within("0", "10");
      expect(await this.sunshine.totalSupply()).to.equal("0");
      expect(await this.sunshine.sumOfEntryTimes()).to.equal("0");
    });

    it("stake x 4 + multiClose + stake + close", async function () {
      for (let i = 0; i < 4; i++) {
        await expect(this.sunshine.open(SUPPLY.div("4"))).to.emit(
          this.sunshine,
          "Opened"
        );
        await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      }

      await expect(this.sunshine.multiClose(["0", "1", "2", "3"])).to.emit(
        this.sunshine,
        "Closed"
      );
      await ethers.provider.send("evm_increaseTime", [
        ONE_DAY.mul("5").toNumber(),
      ]);

      await this.stakingToken.approve(this.sunshine.address, SUPPLY);
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.close("4")).to.emit(this.sunshine, "Closed");

      var blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;
      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var distributed = await this.rewardToken.balanceOf(this.admin.address);

      expect(await this.stakingToken.balanceOf(this.admin.address)).to.equal(
        SUPPLY
      );
      expect(await this.stakingToken.balanceOf(this.sunshine.address)).to.equal(
        "0"
      );
      expect(distributed).to.be.within(reward.sub("10"), reward);

      expect(
        await this.rewardToken.balanceOf(this.sunshine.address)
      ).to.be.within("0", "10");
      expect(await this.sunshine.totalSupply()).to.equal("0");
      expect(await this.sunshine.sumOfEntryTimes()).to.equal("0");
    });

    // this is good enough. we should use echidna for proper fuzzing
  });
});

/****************************************
  _____      _ _ __  __       _   _
 |  ___|   _| | |  \/  | __ _| |_| |__
 | |_ | | | | | | |\/| |/ _` | __| '_ \
 |  _|| |_| | | | |  | | (_| | |_| | | |
 |_|   \__,_|_|_|_|  |_|\__,_|\__|_| |_|

*****************************************/
describe("FullMath.sol", function () {
  before(async function () {
    // get signers
    [this.admin, this.unauthorized] = await ethers.getSigners();

    // get contract factories
    this.FullMath = await ethers.getContractFactory(
      "contracts/sunshine-staking/test/FullMathTest.sol:FullMathTest"
    );
  });

  beforeEach(async function () {
    // deploy library tester
    this.math = await this.FullMath.deploy();
    await this.math.deployed();
  });

  // Test cases
  //
  //////////////////////////////
  //     add(Uint512, Uint512)
  //////////////////////////////
  describe("add(Uint512, Uint512)", function () {
    it("result fits 256bit", async function () {
      await this.math.add(["4129834010293", "0"], ["18989899999912838", "0"]);
      var value = await this.math.testValue();
      expect(value.r0).to.equal("18994029833923131");
      expect(value.r1).to.equal("0");
    });
    it("result does not fit 256bit", async function () {
      await this.math.add(["1", "0"], [UINT256_MAX, "0"]);
      var value = await this.math.testValue();
      expect(value.r0).to.equal("0");
      expect(value.r1).to.equal("1");
    });
    it("result does not fit 256bit (complex values)", async function () {
      await this.math.add(
        ["18020731948", "987092"],
        [UINT256_MAX, "3810247001234987"]
      );
      var value = await this.math.testValue();
      expect(value.r0).to.equal("18020731947");
      expect(value.r1).to.equal("3810247002222080");
    });
  });

  //////////////////////////////
  //     sub(Uint512, Uint512)
  //////////////////////////////
  describe("sub(Uint512, Uint512)", function () {
    it("result fits 256bit", async function () {
      await this.math.sub(["4129834010293", "0"], ["2938419", "0"]);
      var value = await this.math.testValue();
      expect(value.r0).to.equal("4129831071874");
      expect(value.r1).to.equal("0");
    });
    it("result does not fit 256bit (complex values)", async function () {
      await this.math.sub(["23948", "9328417097"], [UINT256_MAX, "239841"]);
      var value = await this.math.testValue();
      expect(value.r0).to.equal("23949");
      expect(value.r1).to.equal("9328177255");
    });
    it("result fits 256bit (complex values)", async function () {
      await this.math.sub(["23948", "9328417097"], [UINT256_MAX, "9328417096"]);
      var value = await this.math.testValue();
      expect(value.r0).to.equal("23949");
      expect(value.r1).to.equal("0");
    });
  });

  //////////////////////////////
  //     mul(Uint256, Uint256)
  //////////////////////////////
  describe("mul(uint256, uint256)", function () {
    it("result is 0", async function () {
      await this.math.mul256("4129834010293", "0");
      var value = await this.math.testValue();
      expect(value.r0).to.equal("0");
      expect(value.r1).to.equal("0");
    });
    it("result fits 256 bits", async function () {
      await this.math.mul256("23948", "308470113412317042317027089");
      var value = await this.math.testValue();
      expect(value.r0).to.equal("7387242275998168529408164727372");
      expect(value.r1).to.equal("0");
    });
    it("result does not fit 256 bits", async function () {
      await this.math.mul256(UINT256_MAX, "308470113412317042317027089");
      var value = await this.math.testValue();
      expect(value.r0).to.equal(
        "115792089237316195423570985008687907853269984665640255569344171690870812612847"
      );
      expect(value.r1).to.equal("308470113412317042317027088");
    });
  });

  //////////////////////////////
  //     mul(Uint512, Uint256)
  //////////////////////////////
  describe("mul(Uint512, uint256)", function () {
    describe("arg 1 fits 256 bits", function () {
      it("multiplication by 0", async function () {
        await this.math.mul512(["4129834010293", "0"], "0");
        var value = await this.math.testValue();
        expect(value.r0).to.equal("0");
        expect(value.r1).to.equal("0");
      });
      it("multiplication fits 256 bits", async function () {
        await this.math.mul512(["23948", "0"], "308470113412317042317027089");
        var value = await this.math.testValue();
        expect(value.r0).to.equal("7387242275998168529408164727372");
        expect(value.r1).to.equal("0");
      });
      it("multiplication does not fit 256 bits", async function () {
        await this.math.mul512(
          [UINT256_MAX, "0"],
          "308470113412317042317027089"
        );
        var value = await this.math.testValue();
        expect(value.r0).to.equal(
          "115792089237316195423570985008687907853269984665640255569344171690870812612847"
        );
        expect(value.r1).to.equal("308470113412317042317027088");
      });
    });
    describe("arg 1 does not fit 256 bits", function () {
      it("multiplication by 0", async function () {
        await this.math.mul512(["4129834010293", "38"], "0");
        var value = await this.math.testValue();
        expect(value.r0).to.equal("0");
        expect(value.r1).to.equal("0");
      });
      it("least significant multiplication fits 256 bits", async function () {
        await this.math.mul512(["23948", "4"], "308470113412317042317027089");
        var value = await this.math.testValue();
        expect(value.r0).to.equal("7387242275998168529408164727372");
        expect(value.r1).to.equal("1233880453649268169268108356");
      });
      it("least significant multiplication does not fit 256 bits", async function () {
        await this.math.mul512(
          [UINT256_MAX, "92837"],
          "308470113412317042317027089"
        );
        var value = await this.math.testValue();
        expect(value.r0).to.equal(
          "115792089237316195423570985008687907853269984665640255569344171690870812612847"
        );
        expect(value.r1).to.equal("28637748388972689574628160888581");
      });
    });
  });

  //////////////////////////////
  //     shiftToUint256(Uint512)
  //////////////////////////////
  describe("shiftToUint256(Uint512)", function () {
    it("input fits 256 bits", async function () {
      await this.math.shiftToUint256(["4129834010293", "0"]);
      var value = await this.math.testValue2();
      expect(value).to.equal("0");
    });
    it("input does not fit 256 bits", async function () {
      await this.math.shiftToUint256(["4129834010293", "312341"]);
      var value = await this.math.testValue2();
      expect(value).to.equal("312341");
    });
  });

  //////////////////////////////
  //     div256(uint256)
  //////////////////////////////
  describe("div256(uint256)", function () {
    it("div by zero", async function () {
      await expect(this.math.div256("0")).to.be.revertedWith(
        "FullMath: division by zero"
      );
    });
    it("div by one", async function () {
      await this.math.div256("1");
      var value = await this.math.testValue();
      expect(value.r0).to.equal("0");
      expect(value.r1).to.equal("1");
    });
    it("div by small number", async function () {
      await this.math.div256("319487312");
      var value = await this.math.testValue();
      expect(value.r0).to.equal(
        "362430947609325391374449903064344251183502350370773297061191538047411"
      );
      expect(value.r1).to.equal("0");
    });
    it("div by large number", async function () {
      await this.math.div256("313918247192834712903870913230491802379487312");
      var value = await this.math.testValue();
      expect(value.r0).to.equal("368860651691225383127087898230216");
      expect(value.r1).to.equal("0");
    });
    it("div by very large number", async function () {
      await this.math.div256(
        "115792089237316195423570985008687907853269984665640564039143665760720294927033"
      );
      var value = await this.math.testValue();
      expect(value.r0).to.equal("1");
      expect(value.r1).to.equal("0");
    });
  });
});

/**********************************************
  ____                  _       _
 |  _ \ ___  __ _ _   _| | __ _| |_ ___  _ __
 | |_) / _ \/ _` | | | | |/ _` | __/ _ \| '__|
 |  _ <  __/ (_| | |_| | | (_| | || (_) | |
 |_| \_\___|\__, |\__,_|_|\__,_|\__\___/|_|
            |___/
***********************************************/
describe("RewardRegulatorFundable.sol", function () {
  before(async function () {
    // Get all signers
    this.signers = await ethers.getSigners();
    this.admin = this.signers[0];
    this.unauthorized = this.signers[1];

    // get contract factories
    this.Png = await ethers.getContractFactory("Png");
    this.Regulator = await ethers.getContractFactory("RewardRegulatorFundable");
  });

  beforeEach(async function () {
    this.token = await this.Png.deploy(
      SUPPLY,
      SUPPLY,
      "REWARD",
      "Reward Token"
    );
    await this.token.deployed();

    this.regulator = await this.Regulator.deploy(this.token.address);
    await this.regulator.deployed();

    await this.regulator.grantRole(FUNDER_ROLE, this.admin.address);
    await this.token.transfer(this.regulator.address, SUPPLY);

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
    it("deploy: reward token zero address", async function () {
      await expect(this.Regulator.deploy(ZERO_ADDRESS)).to.be.revertedWith(
        "Construct: zero address"
      );
    });
    it("arg 1: rewardToken", async function () {
      expect(await this.regulator.rewardToken()).to.equal(this.token.address);
    });
    it("default: rewardsDuration", async function () {
      expect(await this.regulator.rewardsDuration()).to.equal(ONE_DAY);
    });
    it("default: periodFinish", async function () {
      expect(await this.regulator.periodFinish()).to.equal("0");
    });
    it("default: rewardRate", async function () {
      expect(await this.regulator.rewardRate()).to.equal("0");
    });
    it("default: totalWeight", async function () {
      expect(await this.regulator.totalWeight()).to.equal("0");
    });
  });

  //////////////////////////////
  //     recover
  //////////////////////////////
  describe("recover", function () {
    it("admin can recover", async function () {
      expect(await this.token.balanceOf(this.admin.address)).to.equal("0");
      expect(await this.regulator.unreserved()).to.equal(SUPPLY);
      await expect(this.regulator.recover(this.token.address, SUPPLY)).to.emit(
        this.regulator,
        "Recovered"
      );
      expect(await this.regulator.unreserved()).to.equal("0");
      expect(await this.token.balanceOf(this.admin.address)).to.equal(SUPPLY);
    });
    it("unauthorized can't recover", async function () {
      var regulator = await this.regulator.connect(this.unauthorized);
      await expect(regulator.recover(this.token.address, SUPPLY)).to.be
        .reverted;
    });
    it("cannot recover more than reserved", async function () {
      await this.regulator.setRecipients([this.admin.address], ["1"]);
      await this.regulator.notifyRewardAmount(SUPPLY);
      expect(await this.regulator.unreserved()).to.equal("0");
      await expect(
        this.regulator.recover(this.token.address, SUPPLY)
      ).to.be.revertedWith("recover: insufficient unlocked supply");
      await expect(
        this.regulator.recover(this.token.address, "1")
      ).to.be.revertedWith("recover: insufficient unlocked supply");
    });
    it("cannot recover more than reserved (complex)", async function () {
      await this.regulator.setRecipients([this.admin.address], ["1"]);
      await this.regulator.setRewardsDuration(ONE_DAY.mul(100));
      await this.regulator.notifyRewardAmount(SUPPLY.div("2"));
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await this.regulator.claim();
      expect(await this.regulator.unreserved()).to.equal(SUPPLY.div("2"));
      await this.regulator.notifyRewardAmount(SUPPLY.div("2"));
      expect(await this.regulator.unreserved()).to.equal("0");
      await expect(
        this.regulator.recover(this.token.address, "1")
      ).to.be.revertedWith("recover: insufficient unlocked supply");
    });
    it("unauthorized can't recover", async function () {
      var regulator = await this.regulator.connect(this.unauthorized);
      await expect(regulator.recover(this.token.address, SUPPLY)).to.be
        .reverted;
    });
  });

  //////////////////////////////
  //     setRewardsDuration
  //////////////////////////////
  describe("setRewardsDuration", function () {
    it("funder can set rewards duration", async function () {
      await expect(this.regulator.setRewardsDuration(ONE_DAY.mul(100))).to.emit(
        this.regulator,
        "RewardsDurationUpdated"
      );
      expect(await this.regulator.rewardsDuration()).to.equal(ONE_DAY.mul(100));
    });
    it("non-funder cannot set rewards duration", async function () {
      const regulator = await this.regulator.connect(this.unauthorized);
      await expect(regulator.setRewardsDuration(ONE_DAY.mul(100))).to.be
        .reverted;
      expect(await this.regulator.rewardsDuration()).to.equal(ONE_DAY);
    });
    it("cannot set reward duration equal to zero", async function () {
      await expect(this.regulator.setRewardsDuration("0")).to.be.revertedWith(
        "setRewardsDuration: short duration"
      );
      expect(await this.regulator.rewardsDuration()).to.equal(ONE_DAY);
    });
    it("cannot set reward duration during ongoing period", async function () {
      await this.regulator.setRecipients([this.admin.address], ["1"]);
      await this.regulator.notifyRewardAmount(SUPPLY);
      await expect(
        this.regulator.setRewardsDuration(ONE_DAY.mul("100"))
      ).to.be.revertedWith("setRewardsDuration: ongoing period");
      expect(await this.regulator.rewardsDuration()).to.equal(ONE_DAY);
    });
  });

  //////////////////////////////
  //     notifyRewardsAmount
  //////////////////////////////
  describe("notifyRewardAmount", function () {
    it("cannot notify reward when there are no recipients", async function () {
      await expect(
        this.regulator.notifyRewardAmount(SUPPLY)
      ).to.be.revertedWith("notifyRewardAmount: no recipients");
      expect(await this.regulator.rewardRate()).to.equal("0");
    });
    it("cannot notify reward with zero amount", async function () {
      await this.regulator.setRecipients([this.admin.address], ["1"]);
      await expect(this.regulator.notifyRewardAmount("0")).to.be.revertedWith(
        "notifyRewardAmount: zero reward"
      );
      expect(await this.regulator.rewardRate()).to.equal("0");
    });
    it("cannot notify reward with more than reserves", async function () {
      await this.regulator.setRecipients([this.admin.address], ["1"]);
      await expect(
        this.regulator.notifyRewardAmount(SUPPLY.add("1"))
      ).to.be.revertedWith(
        "notifyRewardAmount: insufficient balance for reward"
      );
      expect(await this.regulator.rewardRate()).to.equal("0");
    });
    it("funder can notify reward", async function () {
      await this.regulator.setRecipients([this.admin.address], ["1"]);
      await expect(this.regulator.notifyRewardAmount(SUPPLY)).to.emit(
        this.regulator,
        "RewardAdded"
      );
      expect(await this.regulator.rewardRate()).to.equal(SUPPLY.div(ONE_DAY));
    });
    it("funder can notify reward using `fundReward`", async function () {
      await this.regulator.recover(this.token.address, SUPPLY);
      await this.token.approve(this.regulator.address, SUPPLY);
      await this.regulator.setRecipients([this.admin.address], ["1"]);
      await expect(this.regulator.fundRewards(SUPPLY, "0")).to.emit(
        this.regulator,
        "RewardAdded"
      );
      expect(await this.regulator.rewardRate()).to.equal(SUPPLY.div(ONE_DAY));
    });
    it("non-funder cannot notify reward", async function () {
      await this.regulator.setRecipients([this.admin.address], ["1"]);
      const regulator = await this.regulator.connect(this.unauthorized);
      await expect(regulator.notifyRewardAmount(SUPPLY)).to.be.reverted;
      expect(await this.regulator.rewardRate()).to.equal("0");
    });
    it("funder can notify rewards during ongoing period", async function () {
      await this.regulator.setRecipients([this.admin.address], ["1"]);
      await expect(this.regulator.notifyRewardAmount(SUPPLY.div("2"))).to.emit(
        this.regulator,
        "RewardAdded"
      );
      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      var rewardRate = await this.regulator.rewardRate();
      var periodFinish = await this.regulator.periodFinish();

      expect(rewardRate).to.equal(SUPPLY.div("2").div(ONE_DAY));
      expect(periodFinish).to.equal(ONE_DAY.add(initTime));

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(this.regulator.notifyRewardAmount(SUPPLY.div("2"))).to.emit(
        this.regulator,
        "RewardAdded"
      );

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      var leftover = rewardRate.mul(periodFinish.sub(lastUpdate));

      rewardRate = await this.regulator.rewardRate();
      periodFinish = await this.regulator.periodFinish();

      expect(rewardRate).to.equal(SUPPLY.div("2").add(leftover).div(ONE_DAY));
      expect(periodFinish).to.equal(ONE_DAY.add(lastUpdate));
    });
  });

  //////////////////////////////
  //     setRecipients
  //////////////////////////////
  describe("setRecipients", function () {
    it("owner sets one recipient", async function () {
      await expect(
        this.regulator.setRecipients([this.admin.address], ["1"])
      ).to.emit(this.regulator, "RecipientSet");
      expect(await this.regulator.totalWeight()).to.equal("1");
      var recipient = await this.regulator.recipients(this.admin.address);
      expect(recipient.weight).to.equal("1");
      expect(recipient.stash).to.equal("0");
      expect(recipient.rewardPerWeightPaid).to.equal("0");
      var allRecipients = await this.regulator.getAllRecipients();
      expect(allRecipients.length).to.equal(1);
      expect(allRecipients[0]).to.equal(this.admin.address);
    });
    it("owner sets one recipient after another with varying weights", async function () {
      await expect(
        this.regulator.setRecipients([this.admin.address], ["1"])
      ).to.emit(this.regulator, "RecipientSet");

      await this.regulator.setRewardsDuration(ONE_DAY.mul(100));
      await this.regulator.notifyRewardAmount(SUPPLY);

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(
        this.regulator.setRecipients([this.unauthorized.address], ["2"])
      ).to.emit(this.regulator, "RecipientSet");

      blockNumber = await ethers.provider.getBlockNumber();
      var secondUpdate = (await ethers.provider.getBlock(blockNumber))
        .timestamp;

      var rate = SUPPLY.div(ONE_DAY.mul(100));
      var reward = rate.mul(secondUpdate - initTime);

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(
        this.regulator.setRecipients([this.unauthorized.address], ["0"])
      ).to.emit(this.regulator, "RecipientSet");

      expect(await this.regulator.totalWeight()).to.equal("1");

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      var reward2 = rate.mul(lastUpdate - secondUpdate);

      var adminReward = reward.add(reward2.div("3"));
      var unauthReward = reward2.mul("2").div("3");

      var recipient = await this.regulator.recipients(this.admin.address);
      expect(recipient.weight).to.equal("1");
      expect(recipient.stash).to.equal("0");
      expect(recipient.rewardPerWeightPaid).to.equal("0");
      expect(await this.regulator.pendingRewards(this.admin.address)).to.equal(
        adminReward
      );

      recipient = await this.regulator.recipients(this.unauthorized.address);
      expect(recipient.weight).to.equal("0");
      expect(recipient.stash).to.equal(unauthReward);
      expect(recipient.rewardPerWeightPaid).to.equal(
        reward.add(reward2.div("3"))
      );
      expect(
        await this.regulator.pendingRewards(this.unauthorized.address)
      ).to.equal(unauthReward);

      var allRecipients = await this.regulator.getAllRecipients();
      expect(allRecipients.length).to.equal(1);
      expect(allRecipients[0]).to.equal(this.admin.address);
    });
    it("cannot set recipients when array length differs", async function () {
      await expect(
        this.regulator.setRecipients([this.admin.address], ["1", "1"])
      ).to.be.revertedWith("setRecipients: unequal lengths");
    });
    it("cannot set recipients when old weight is the same", async function () {
      await expect(
        this.regulator.setRecipients([this.admin.address], ["0"])
      ).to.be.revertedWith("setRecipients: same weight");
    });
    it("owner removes recipients", async function () {
      await expect(
        this.regulator.setRecipients([this.admin.address], ["1"])
      ).to.emit(this.regulator, "RecipientSet");
      await expect(
        this.regulator.setRecipients([this.admin.address], ["0"])
      ).to.emit(this.regulator, "RecipientSet");
      expect(await this.regulator.totalWeight()).to.equal("0");
      var recipient = await this.regulator.recipients(this.admin.address);
      expect(recipient.weight).to.equal("0");
      expect(recipient.stash).to.equal("0");
      expect(recipient.rewardPerWeightPaid).to.equal("0");
      var allRecipients = await this.regulator.getAllRecipients();
      expect(allRecipients.length).to.equal(0);
    });
    it("unprivileged cannot change recipient", async function () {
      var regulator = await this.regulator.connect(this.unauthorized);
      await expect(regulator.setRecipients([this.admin.address], ["1"])).to.be
        .reverted;
    });
    it("cannot remove all recipients during ongoing period", async function () {
      await expect(
        this.regulator.setRecipients([this.admin.address], ["1"])
      ).to.emit(this.regulator, "RecipientSet");
      await this.regulator.notifyRewardAmount(SUPPLY);
      await expect(
        this.regulator.setRecipients([this.admin.address], ["0"])
      ).to.be.revertedWith("setRecipients: active period");
    });
    it("owner sets two recipient", async function () {
      await expect(
        this.regulator.setRecipients(
          [this.admin.address, this.unauthorized.address],
          ["1", "1"]
        )
      ).to.emit(this.regulator, "RecipientSet");
      expect(await this.regulator.totalWeight()).to.equal("2");
      var recipient = await this.regulator.recipients(this.admin.address);
      expect(recipient.weight).to.equal("1");
      expect(recipient.stash).to.equal("0");
      expect(recipient.rewardPerWeightPaid).to.equal("0");
      recipient = await this.regulator.recipients(this.unauthorized.address);
      expect(recipient.weight).to.equal("1");
      expect(recipient.stash).to.equal("0");
      expect(recipient.rewardPerWeightPaid).to.equal("0");
      var allRecipients = await this.regulator.getAllRecipients();
      expect(allRecipients.length).to.equal(2);
      expect(allRecipients[0]).to.equal(this.admin.address);
      expect(allRecipients[1]).to.equal(this.unauthorized.address);
    });
    it("removes one recipient after setting one", async function () {
      await expect(
        this.regulator.setRecipients(
          [this.admin.address, this.unauthorized.address],
          ["1", "1"]
        )
      ).to.emit(this.regulator, "RecipientSet");
      await expect(
        this.regulator.setRecipients([this.unauthorized.address], ["0"])
      ).to.emit(this.regulator, "RecipientSet");
      expect(await this.regulator.totalWeight()).to.equal("1");
      var recipient = await this.regulator.recipients(this.admin.address);
      expect(recipient.weight).to.equal("1");
      expect(recipient.stash).to.equal("0");
      expect(recipient.rewardPerWeightPaid).to.equal("0");
      recipient = await this.regulator.recipients(this.unauthorized.address);
      expect(recipient.weight).to.equal("0");
      expect(recipient.stash).to.equal("0");
      expect(recipient.rewardPerWeightPaid).to.equal("0");
      var allRecipients = await this.regulator.getAllRecipients();
      expect(allRecipients.length).to.equal(1);
      expect(allRecipients[0]).to.equal(this.admin.address);
    });
    it("removes one recipient during funding", async function () {
      await expect(
        this.regulator.setRecipients(
          [this.admin.address, this.unauthorized.address],
          ["1", "1"]
        )
      ).to.emit(this.regulator, "RecipientSet");
      await this.regulator.setRewardsDuration(ONE_DAY.mul(100));
      await this.regulator.notifyRewardAmount(SUPPLY);
      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(
        this.regulator.setRecipients([this.unauthorized.address], ["0"])
      ).to.emit(this.regulator, "RecipientSet");

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      var rate = SUPPLY.div(ONE_DAY.mul(100));
      var reward = rate.mul(lastUpdate - initTime);

      expect(await this.regulator.totalWeight()).to.equal("1");

      var recipient = await this.regulator.recipients(this.admin.address);
      expect(recipient.weight).to.equal("1");
      expect(recipient.stash).to.equal("0");
      expect(recipient.rewardPerWeightPaid).to.equal("0");
      expect(await this.regulator.pendingRewards(this.admin.address)).to.equal(
        reward.div("2")
      );

      recipient = await this.regulator.recipients(this.unauthorized.address);
      expect(recipient.weight).to.equal("0");
      expect(recipient.stash).to.equal(reward.div("2"));
      expect(recipient.rewardPerWeightPaid).to.equal(reward.div("2"));
      expect(
        await this.regulator.pendingRewards(this.unauthorized.address)
      ).to.equal(reward.div("2"));

      var allRecipients = await this.regulator.getAllRecipients();
      expect(allRecipients.length).to.equal(1);
      expect(allRecipients[0]).to.equal(this.admin.address);
    });
  });

  //////////////////////////////
  //     claim
  //////////////////////////////
  describe("claim", function () {
    it("claims nothing", async function () {
      await this.regulator.claim();
    });
    it("claims rewards", async function () {
      await expect(
        this.regulator.setRecipients([this.admin.address], ["1"])
      ).to.emit(this.regulator, "RecipientSet");

      var supply = SUPPLY.div(BigNumber.from("10").pow("18"));

      await this.regulator.setRewardsDuration(supply);
      await this.regulator.notifyRewardAmount(SUPPLY);
      await ethers.provider.send("evm_increaseTime", [supply.toNumber()]);

      await expect(this.regulator.claim()).to.emit(this.regulator, "Claimed");
      expect(await this.token.balanceOf(this.admin.address)).to.equal(SUPPLY);
    });
  });
});

/******************************************************
     _             _
 ___(_)_ __   __ _| | ___    ___ ___  _ __ ___  _ __
/ __| | '_ \ / _` | |/ _ \  / __/ _ \| '_ ` _ \| '_ \
\__ \ | | | | (_| | |  __/ | (_| (_) | | | | | | |_) |
|___/_|_| |_|\__, |_|\___|  \___\___/|_| |_| |_| .__(_)
             |___/                             |_|
*******************************************************/
describe("SunshineAndRainbowsCompoundSingle.sol", function () {
  before(async function () {
    // Get all signers
    this.signers = await ethers.getSigners();
    this.admin = this.signers[0];
    this.unauthorized = this.signers[1];

    // get contract factories
    this.Png = await ethers.getContractFactory("Png");
    this.Sunshine = await ethers.getContractFactory(
      "SunshineAndRainbowsCompoundSingle"
    );
    this.Regulator = await ethers.getContractFactory("RewardRegulatorFundable");
  });

  beforeEach(async function () {
    // REWARD TOKEN IS STAKING TOKEN
    this.token = await this.Png.deploy(
      SUPPLY.mul("2"),
      SUPPLY.mul("2"),
      "TOKEN",
      "Token"
    );
    await this.token.deployed();

    this.regulator = await this.Regulator.deploy(this.token.address);
    await this.regulator.deployed();

    this.sunshine = await this.Sunshine.deploy(
      this.token.address,
      this.regulator.address
    );
    await this.sunshine.deployed();

    await this.token.transfer(this.regulator.address, SUPPLY);
    await this.token.approve(this.sunshine.address, SUPPLY);

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
      expect(await this.sunshine.stakingToken()).to.equal(this.token.address);
    });

    it("arg 2: rewardRegulator", async function () {
      expect(await this.sunshine.rewardRegulator()).to.equal(
        this.regulator.address
      );
    });

    it("default: rewardToken", async function () {
      expect(await this.sunshine.rewardToken()).to.equal(this.token.address);
    });

    it("deploy: stakind and reward token not same", async function () {
      let token = ethers.Wallet.createRandom();
      await expect(
        this.Sunshine.deploy(token.address, this.regulator.address)
      ).to.be.revertedWith("SAR::Constructor: invalid staking token");
    });
  });

  describe("Compound", function () {
    it("compounds after staking", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.compound("0")).to.emit(
        this.sunshine,
        "Compounded"
      );

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var claimed = SUPPLY.sub(
        await this.token.balanceOf(this.regulator.address)
      );
      expect(claimed).to.be.within(reward.sub("2"), reward);

      var interval = lastUpdate - initTime; // also the stakingDuration

      var [idealPosition, rewardsPerStakingDuration] = updateRewardVariables(
        claimed,
        SUPPLY.mul(interval),
        interval
      );

      // parent position
      var position = await this.sunshine.positions("0");
      expect(position.balance).to.equal(SUPPLY);
      expect(position.lastUpdate).to.equal(initTime);
      expect(position.owner).to.equal(this.admin.address);
      expect(position.idealPosition.r0).to.equal("0");
      expect(position.idealPosition.r1).to.equal("0");
      expect(position.rewardsPerStakingDuration.r0).to.equal("0");
      expect(position.rewardsPerStakingDuration.r1).to.equal("0");
      var child = await this.sunshine.children("0");
      expect(child.parent).to.equal("0");
      expect(child.initTime).to.equal("0");

      // child position
      position = await this.sunshine.positions("1");
      expect(position.balance).to.be.within(claimed.sub("2"), claimed);
      expect(position.lastUpdate).to.equal(lastUpdate);
      expect(position.owner).to.equal(this.admin.address);
      expect(position.idealPosition.r0).to.equal(idealPosition);
      expect(position.idealPosition.r1).to.equal("0");
      expect(position.rewardsPerStakingDuration.r0).to.equal(
        rewardsPerStakingDuration
      );
      expect(position.rewardsPerStakingDuration.r1).to.equal("0");
      child = await this.sunshine.children("1");
      expect(child.parent).to.equal("0");
      expect(child.initTime).to.equal(lastUpdate);

      // global variables
      expect(await this.token.balanceOf(this.sunshine.address)).to.equal(
        SUPPLY.add(claimed)
      );
      expect(await this.sunshine.totalSupply()).to.equal(
        SUPPLY.add(position.balance)
      );
      expect(await this.sunshine.sumOfEntryTimes()).to.equal(
        SUPPLY.mul(initTime).add(position.balance.mul(lastUpdate))
      );
      expect(await this.sunshine.initTime()).to.equal(initTime);

      var pending = await this.sunshine.pendingRewards(["0", "1"]);
      expect(pending[0]).to.equal("0");
      expect(pending[1]).to.equal("0");
    });

    it("cannot compound others position", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      var sunshine = await this.sunshine.connect(this.unauthorized);
      await expect(sunshine.compound("0")).to.be.reverted;
    });

    it("cannot compound non-existent position", async function () {
      await expect(this.sunshine.compound("0")).to.be.reverted;
    });

    it("cannot withdraw from child position", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(this.sunshine.compound("0")).to.emit(
        this.sunshine,
        "Compounded"
      );
      await expect(this.sunshine.close("1")).to.be.revertedWith(
        "SAR::_withdraw: parent position not updated"
      );
      await expect(this.sunshine.multiClose(["1"])).to.be.revertedWith(
        "SAR::_withdraw: parent position not updated"
      );
      await expect(this.sunshine.withdraw("1", "1")).to.be.revertedWith(
        "SAR::_withdraw: parent position not updated"
      );
      await expect(
        this.sunshine.multiWithdraw(["1"], "0", "1")
      ).to.be.revertedWith("SAR::_withdraw: parent position not updated");

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(this.sunshine.harvest("1")).to.emit(
        this.sunshine,
        "Harvested"
      );
      var balance = await this.token.balanceOf(this.admin.address);
      await this.token.approve(this.sunshine.address, balance);
      await expect(this.sunshine.open(balance)).to.emit(
        this.sunshine,
        "Opened"
      );
      await expect(
        this.sunshine.multiWithdraw(["2"], "1", "1")
      ).to.be.revertedWith("SAR::_withdraw: parent position not updated");
    });
    it("can multiClose with parent position", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(this.sunshine.compound("0")).to.emit(
        this.sunshine,
        "Compounded"
      );
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(this.sunshine.multiClose(["0", "1"])).to.emit(
        this.sunshine,
        "Closed"
      );
    });
    it("can close after parent position is updated", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(this.sunshine.compound("0")).to.emit(
        this.sunshine,
        "Compounded"
      );
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(this.sunshine.harvest("0")).to.emit(
        this.sunshine,
        "Harvested"
      );
      await expect(this.sunshine.close("1")).to.emit(this.sunshine, "Closed");
    });
    it("can withdraw after parent is updated", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(this.sunshine.compound("0")).to.emit(
        this.sunshine,
        "Compounded"
      );
      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(this.sunshine.harvest("0")).to.emit(
        this.sunshine,
        "Harvested"
      );
      var balance = (await this.sunshine.positions("1")).balance;
      await expect(this.sunshine.withdraw("1", balance.sub("1"))).to.emit(
        this.sunshine,
        "Withdrawn"
      );
    });

    it("closing with correct rewards after compound", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.compound("0")).to.emit(
        this.sunshine,
        "Compounded"
      );

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(this.sunshine.multiClose(["0", "1"])).to.emit(
        this.sunshine,
        "Closed"
      );

      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var claimed = SUPPLY.sub(
        await this.token.balanceOf(this.regulator.address)
      );
      expect(claimed).to.be.within(reward.sub("4"), reward);

      // parent position
      var position = await this.sunshine.positions("0");
      expect(position.balance).to.equal("0");

      // child position
      position = await this.sunshine.positions("1");
      expect(position.balance).to.equal("0");

      // global variables
      expect(await this.token.balanceOf(this.sunshine.address)).to.be.within(
        "0",
        "4"
      );
      expect(await this.sunshine.totalSupply()).to.equal("0");
      expect(await this.sunshine.sumOfEntryTimes()).to.equal("0");
      expect(await this.sunshine.initTime()).to.equal(initTime);

      var pending = await this.sunshine.pendingRewards(["0", "1"]);
      expect(pending[0]).to.equal("0");
      expect(pending[1]).to.equal("0");
    });

    it("withdrawing 1/4 with correct rewards after compound", async function () {
      await expect(this.sunshine.open(SUPPLY)).to.emit(this.sunshine, "Opened");

      var blockNumber = await ethers.provider.getBlockNumber();
      var initTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);

      await expect(this.sunshine.compound("0")).to.emit(
        this.sunshine,
        "Compounded"
      );

      blockNumber = await ethers.provider.getBlockNumber();
      var compoundTime = (await ethers.provider.getBlock(blockNumber))
        .timestamp;
      var balance = (await this.sunshine.positions("1")).balance;

      await ethers.provider.send("evm_increaseTime", [ONE_DAY.toNumber()]);
      await expect(
        this.sunshine.multiWithdraw(["0"], "1", balance.div("4"))
      ).to.emit(this.sunshine, "Closed");
      blockNumber = await ethers.provider.getBlockNumber();
      var lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      var reward = getRewards(lastUpdate - this.notifyRewardTime);
      var claimed = SUPPLY.sub(
        await this.token.balanceOf(this.regulator.address)
      );
      expect(claimed).to.be.within(reward.sub("4"), reward);

      // parent position
      var position = await this.sunshine.positions("0");
      expect(position.balance).to.equal("0");

      // child position
      position = await this.sunshine.positions("1");
      balance = balance.sub(balance.div("4"));
      expect(position.balance).to.equal(balance);

      var pending = await this.sunshine.pendingRewards(["0", "1"]);
      expect(pending[0]).to.equal("0");

      // global variables
      expect(await this.token.balanceOf(this.sunshine.address)).to.be.within(
        balance.add(pending[1]),
        balance.add(pending[1]).add("4")
      );
      expect(await this.sunshine.totalSupply()).to.equal(balance);
      expect(await this.sunshine.sumOfEntryTimes()).to.equal(
        balance.mul(compoundTime)
      );
      expect(await this.sunshine.initTime()).to.equal(initTime);

      await expect(this.sunshine.close("1")).to.emit(this.sunshine, "Closed");
      position = await this.sunshine.positions("1");
      expect(position.balance).to.equal("0");
      expect(await this.token.balanceOf(this.sunshine.address)).to.be.within(
        "0",
        "4"
      );
      expect(await this.sunshine.totalSupply()).to.equal("0");
      pending = await this.sunshine.pendingRewards(["1"]);
      expect(pending[0]).to.equal("0");
    });
  });
});

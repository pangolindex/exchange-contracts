// test/PNG.js
// Load dependencies
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");
const chance = require("chance").Chance();

const DENOMINATOR = BigNumber.from("10000");
const STARTING_BALANCE = ethers.utils.parseUnits("218500000", 18);
const TOTAL_SUPPLY = ethers.utils.parseUnits("230000000", 18);
const ZERO_ADDRESS = ethers.constants.AddressZero;
const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));
const FUNDER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("FUNDER_ROLE"));

const distributionSchedule = [
  2500, 1400, 800, 530, 390,
   370,  350, 330, 310, 290,
   270,  250, 235, 220, 205,
   190,  175, 160, 145, 130,
   120,  110, 100,  90,  80,
    70,   60,  50,  40,  30
];

function generateRecipients(recipientsLength) {
  let recipients = [];
  let totalAlloc = 0;

  for (let i = 0; i < recipientsLength; i++) {
    let account = ethers.Wallet.createRandom();
    let alloc;
    if (i === recipientsLength - 1) {
      alloc = DENOMINATOR - totalAlloc;
    } else {
      alloc = chance.integer({
        min: 1,
        max: DENOMINATOR - totalAlloc - (recipientsLength - i - 1)
      });
    }
    totalAlloc += alloc;
    recipients.push(
      {
        account: account.address,
        allocation: BigNumber.from(alloc),
        isMiniChef: false
      }
    )
  };

  return recipients;

};

// Start test block
// Only tests for the new features added by shung
describe("TreasuryVester.sol", function () {
  before(async function () {
    // Get addresses that might send transactions
    [ this.admin, this.guardian, this.unauthorized ] = await ethers.getSigners();

    // get contract factories
    this.Vester = await ethers.getContractFactory("TreasuryVester");
    this.Png = await ethers.getContractFactory("Png");
    this.Chef = await ethers.getContractFactory("MiniChefV2");

  });


  beforeEach(async function () {
    this.recipients = generateRecipients(7);

    // Deploy PNG
    this.png = await this.Png.deploy(
      TOTAL_SUPPLY, // max supply
      0, // initial mint
      "PNG",
      "Pangolin"
    );
    await this.png.deployed();

    // Deploy Treasury Vester
    this.vester = await this.Vester.deploy(
        this.png.address,
        STARTING_BALANCE,
        this.recipients,
        this.guardian.address
      );
    await this.vester.deployed();

    await this.png.grantRole(MINTER_ROLE, this.vester.address);
  });


  // Test cases


  //////////////////////////////
  //     Constructor
  //////////////////////////////
  describe("Constructor", function () {
    it("arg 1: vesting token", async function () {
      expect(await this.vester.vestedToken()).to.equal(this.png.address);
    });

    it("arg 2: starting balance", async function () {
      expect(await this.vester.startingBalance()).to.equal(STARTING_BALANCE);
    });

    it("arg 3: recipients", async function () {
      var recipients = await this.vester.getRecipients();
      expect(recipients.length).to.equal(this.recipients.length);
      for (let i = 0; i < recipients.length; i++) {
        expect(recipients[i].account).to.equal(this.recipients[i].account);
        expect(recipients[i].allocation).to.equal(this.recipients[i].allocation);
        expect(recipients[i].isMiniChef).to.equal(this.recipients[i].isMiniChef);
      }
    });

    it("arg 4: guardian", async function () {
      expect(await this.vester.guardian()).to.equal(this.guardian.address);
    });

    it("default: vesting not enabled", async function () {
      expect(await this.vester.vestingEnabled()).to.equal(false);
    });

    it("default: not updated", async function () {
      expect(await this.vester.lastUpdate()).to.equal("0");
    });

    it("default: never vested", async function () {
      expect(await this.vester.step()).to.equal("0");
      expect(await this.vester.getVestingAmount()).to.equal("0");
    });

  });


  //////////////////////////////
  //     startVesting
  //////////////////////////////
  describe("startVesting", function () {
    it("unauthorized cannot start vesting", async function() {
      expect(await this.vester.vestingEnabled()).to.equal(false);

      let vester = await this.vester.connect(this.unauthorized);

      await expect(vester.startVesting()).to.be.revertedWith(
        "TreasuryVester::startVesting: unauthorized message sender"
      );

      expect(await this.vester.vestingEnabled()).to.equal(false);
    });

    it("admin can start vesting", async function() {
      expect(await this.vester.vestingEnabled()).to.equal(false);

      await expect(this.vester.startVesting()).to.emit(this.vester, "VestingEnabled");

      expect(await this.vester.vestingEnabled()).to.equal(true);
    });

    it("guardian can start vesting", async function() {
      expect(await this.vester.vestingEnabled()).to.equal(false);

      let vester = await this.vester.connect(this.guardian);

      await expect(vester.startVesting()).to.emit(this.vester, "VestingEnabled");

      expect(await this.vester.vestingEnabled()).to.equal(true);
    });

    it("cannot start vesting twice", async function() {
      expect(await this.vester.vestingEnabled()).to.equal(false);

      await expect(this.vester.startVesting()).to.emit(this.vester, "VestingEnabled");

      expect(await this.vester.vestingEnabled()).to.equal(true);

      await expect(this.vester.startVesting()).to.be.revertedWith(
        "TreasuryVester::startVesting: vesting is already enabled"
      );

      expect(await this.vester.vestingEnabled()).to.equal(true);
    });

  });


  //////////////////////////////
  //     setRecipients
  //////////////////////////////
  describe("setRecipients", function () {
    it("unauthorized cannot change recipients", async function() {
      var oldRecipients = await this.vester.getRecipients();

      let vester = await this.vester.connect(this.guardian);

      await expect(vester.setRecipients(
        [{ account: this.guardian.address, allocation: DENOMINATOR }]
      )).to.be.revertedWith("Ownable: caller is not the owner");

      var newRecipients = await this.vester.getRecipients();

      expect(newRecipients.length).to.equal(oldRecipients.length);
      for (let i = 0; i < newRecipients.length; i++) {
        expect(newRecipients[i].account).to.equal(oldRecipients[i].account);
        expect(newRecipients[i].allocation).to.equal(oldRecipients[i].allocation);
        expect(newRecipients[i].isMiniChef).to.equal(oldRecipients[i].isMiniChef);
      }
    });

    it("cannot set zero recipients", async function() {
      var oldRecipients = await this.vester.getRecipients();

      await expect(this.vester.setRecipients([])).to.be.revertedWith(
        "TreasuryVester::setRecipients: invalid recipient number"
      );

      var newRecipients = await this.vester.getRecipients();

      expect(newRecipients.length).to.equal(oldRecipients.length);
      for (let i = 0; i < newRecipients.length; i++) {
        expect(newRecipients[i].account).to.equal(oldRecipients[i].account);
        expect(newRecipients[i].allocation).to.equal(oldRecipients[i].allocation);
        expect(newRecipients[i].isMiniChef).to.equal(oldRecipients[i].isMiniChef);
      }
    });

    it("cannot set a recipient with zero address", async function() {
      var oldRecipients = await this.vester.getRecipients();

      recipients = generateRecipients(10);
      recipients[0].account = ZERO_ADDRESS;

      await expect(this.vester.setRecipients(recipients)).to.be.revertedWith(
        "TreasuryVester::setRecipients: invalid recipient address"
      );

      var newRecipients = await this.vester.getRecipients();

      expect(newRecipients.length).to.equal(oldRecipients.length);
      for (let i = 0; i < newRecipients.length; i++) {
        expect(newRecipients[i].account).to.equal(oldRecipients[i].account);
        expect(newRecipients[i].allocation).to.equal(oldRecipients[i].allocation);
        expect(newRecipients[i].isMiniChef).to.equal(oldRecipients[i].isMiniChef);
      }
    });

    it("cannot set a recipient with zero allocation", async function() {
      var oldRecipients = await this.vester.getRecipients();

      recipients = generateRecipients(10);
      recipients[0].allocation = BigNumber.from("0");

      await expect(this.vester.setRecipients(recipients)).to.be.revertedWith(
        "TreasuryVester::setRecipients: invalid recipient allocation"
      );

      var newRecipients = await this.vester.getRecipients();

      expect(newRecipients.length).to.equal(oldRecipients.length);
      for (let i = 0; i < newRecipients.length; i++) {
        expect(newRecipients[i].account).to.equal(oldRecipients[i].account);
        expect(newRecipients[i].allocation).to.equal(oldRecipients[i].allocation);
        expect(newRecipients[i].isMiniChef).to.equal(oldRecipients[i].isMiniChef);
      }
    });

    it("cannot make total allocation more than denominator", async function() {
      var oldRecipients = await this.vester.getRecipients();

      recipients = generateRecipients(10);
      recipients[0].allocation = recipients[0].allocation.add("1");

      await expect(this.vester.setRecipients(recipients)).to.be.revertedWith(
        "TreasuryVester::setRecipients: invalid total allocation"
      );

      var newRecipients = await this.vester.getRecipients();

      expect(newRecipients.length).to.equal(oldRecipients.length);
      for (let i = 0; i < newRecipients.length; i++) {
        expect(newRecipients[i].account).to.equal(oldRecipients[i].account);
        expect(newRecipients[i].allocation).to.equal(oldRecipients[i].allocation);
        expect(newRecipients[i].isMiniChef).to.equal(oldRecipients[i].isMiniChef);
      }
    });

    it("cannot make total allocation less than denominator", async function() {
      var oldRecipients = await this.vester.getRecipients();

      recipients = generateRecipients(10);
      for (let i = 0; i < 10; i++) {
        if (recipients[i].allocation > 1) {
          recipients[i].allocation = recipients[i].allocation.sub("1");
          break
        }
      }

      await expect(this.vester.setRecipients(recipients)).to.be.revertedWith(
        "TreasuryVester::setRecipients: invalid total allocation"
      );

      var newRecipients = await this.vester.getRecipients();

      expect(newRecipients.length).to.equal(oldRecipients.length);
      for (let i = 0; i < newRecipients.length; i++) {
        expect(newRecipients[i].account).to.equal(oldRecipients[i].account);
        expect(newRecipients[i].allocation).to.equal(oldRecipients[i].allocation);
        expect(newRecipients[i].isMiniChef).to.equal(oldRecipients[i].isMiniChef);
      }
    });

    it("admin can set one recipient", async function() {
      recipients = generateRecipients(1);

      await expect(this.vester.setRecipients(recipients)).to.emit(
        this.vester, "RecipientsChanged"
      );

      var newRecipients = await this.vester.getRecipients();

      expect(newRecipients.length).to.equal(recipients.length).to.equal(1);
      expect(newRecipients[0].account).to.equal(recipients[0].account);
      expect(newRecipients[0].allocation).to.equal(recipients[0].allocation);
      expect(newRecipients[0].isMiniChef).to.equal(recipients[0].isMiniChef);
    });

    it("admin can set multiple recipients", async function() {
      recipients = generateRecipients(10);

      await expect(this.vester.setRecipients(recipients)).to.emit(
        this.vester, "RecipientsChanged"
      );

      var newRecipients = await this.vester.getRecipients();

      expect(newRecipients.length).to.equal(recipients.length);
      for (let i = 0; i < newRecipients.length; i++) {
        expect(newRecipients[i].account).to.equal(recipients[i].account);
        expect(newRecipients[i].allocation).to.equal(recipients[i].allocation);
        expect(newRecipients[i].isMiniChef).to.equal(recipients[i].isMiniChef);
      }
    });

  });


  //////////////////////////////
  //     distribute
  //////////////////////////////
  describe("distribute", function () {
    it("cannot distribute when vesting disabled", async function() {
      var oldStep = await this.vester.step();
      var oldSupply = await this.png.totalSupply();

      await expect(this.vester.distribute()).to.be.revertedWith(
        "TreasuryVester::distribute: vesting is not enabled"
      );

      var newStep = await this.vester.step();
      var newSupply = await this.png.totalSupply();

      expect(oldStep).to.equal(newStep);
      expect(oldSupply).to.equal(newSupply);
    });

    it("any can distribute when vesting enabled", async function() {
      expect(await this.vester.vestingEnabled()).to.equal(false);

      let vester = await this.vester.connect(this.guardian);
      await expect(vester.startVesting()).to.emit(this.vester, "VestingEnabled");

      expect(await this.vester.vestingEnabled()).to.equal(true);

      var oldStep = await this.vester.step();
      var oldSupply = await this.png.totalSupply();

      vester = await this.vester.connect(this.unauthorized);
      await expect(vester.distribute()).to.emit(this.vester, "TokensVested");

      var newStep = await this.vester.step();
      var newSupply = await this.png.totalSupply();
      newSupply = newSupply.toString().slice(0, -3);
      var expectedNewSupply =
        oldSupply
          .add(
            STARTING_BALANCE
              .mul(distributionSchedule[0])
              .div(DENOMINATOR)
              .div("30")
          ).toString().slice(0, -3)

      expect(oldStep.add("1")).to.equal(newStep);
      expect(expectedNewSupply).to.equal(newSupply);
    });

    it("cannot distribute before vesting cliff is over", async function() {
      expect(await this.vester.vestingEnabled()).to.equal(false);

      let vester = await this.vester.connect(this.guardian);
      await expect(vester.startVesting()).to.emit(this.vester, "VestingEnabled");

      expect(await this.vester.vestingEnabled()).to.equal(true);

      var oldStep = await this.vester.step();
      var oldSupply = await this.png.totalSupply();

      vester = await this.vester.connect(this.unauthorized);
      await expect(vester.distribute()).to.emit(this.vester, "TokensVested");

      var newStep = await this.vester.step();
      var newSupply = await this.png.totalSupply();
      var expectedNewSupply =
        oldSupply
          .add(
            STARTING_BALANCE
              .mul(distributionSchedule[0])
              .div(DENOMINATOR)
              .div("30")
          ).toString().slice(0, -3)

      expect(oldStep.add("1")).to.equal(newStep);
      expect(expectedNewSupply).to.equal(newSupply.toString().slice(0, -3));

      await network.provider.send("evm_increaseTime", [86000]);

      await expect(vester.distribute()).to.be.revertedWith(
        "TreasuryVester::distribute: it is too early to distribute"
      );

      var newerStep = await this.vester.step();
      var newerSupply = await this.png.totalSupply();

      expect(newStep).to.equal(newerStep);
      expect(newSupply).to.equal(newerSupply);

    });

    it("can distribute after vesting cliff is over", async function() {
      expect(await this.vester.vestingEnabled()).to.equal(false);

      let vester = await this.vester.connect(this.guardian);
      await expect(vester.startVesting()).to.emit(this.vester, "VestingEnabled");

      expect(await this.vester.vestingEnabled()).to.equal(true);

      var oldStep = await this.vester.step();
      var oldSupply = await this.png.totalSupply();

      vester = await this.vester.connect(this.unauthorized);
      await expect(vester.distribute()).to.emit(this.vester, "TokensVested");

      var newStep = await this.vester.step();
      var newSupply = await this.png.totalSupply();
      var expectedNewSupply =
        oldSupply
          .add(
            STARTING_BALANCE
              .mul(distributionSchedule[0])
              .div(DENOMINATOR)
              .div("30")
          ).toString().slice(0, -3)

      expect(oldStep.add("1")).to.equal(newStep);
      expect(expectedNewSupply).to.equal(newSupply.toString().slice(0, -3));

      await network.provider.send("evm_increaseTime", [86400]);

      await expect(vester.distribute()).to.emit(this.vester, "TokensVested");

      var newerStep = await this.vester.step();
      var newerSupply = await this.png.totalSupply();
      var expectedNewerSupply =
        newSupply
          .add(
            STARTING_BALANCE
              .mul(distributionSchedule[0])
              .div(DENOMINATOR)
              .div("30")
          ).toString().slice(0, -3)

      expect(newStep.add("1")).to.equal(newerStep);
      expect(expectedNewerSupply).to.equal(newerSupply.toString().slice(0, -3));

    });

    it("distributes to MiniChef", async function() {
      recipients = generateRecipients(10);

      chef = await this.Chef.deploy(this.png.address, this.admin.address);
      await chef.deployed();

      await expect(chef.addFunder(this.vester.address)).to.emit(chef, "FunderAdded");
      expect(await chef.isFunder(this.vester.address)).to.equal(true);

      recipients[0].isMiniChef = true;
      recipients[0].account = chef.address;

      await expect(this.vester.setRecipients(recipients)).to.emit(
        this.vester, "RecipientsChanged"
      );

      var newRecipients = await this.vester.getRecipients();

      expect(newRecipients.length).to.equal(recipients.length);
      for (let i = 0; i < newRecipients.length; i++) {
        expect(newRecipients[i].account).to.equal(recipients[i].account);
        expect(newRecipients[i].allocation).to.equal(recipients[i].allocation);
        expect(newRecipients[i].isMiniChef).to.equal(recipients[i].isMiniChef);
      }

      expect(await this.vester.vestingEnabled()).to.equal(false);

      await expect(this.vester.startVesting()).to.emit(this.vester, "VestingEnabled");

      expect(await this.vester.vestingEnabled()).to.equal(true);

      var oldStep = await this.vester.step();
      var oldSupply = await this.png.totalSupply();

      vester = await this.vester.connect(this.unauthorized);
      await expect(vester.distribute()).to.emit(this.vester, "TokensVested");

      var newStep = await this.vester.step();
      var newSupply = await this.png.totalSupply();
      var vestingAmount = STARTING_BALANCE.mul(distributionSchedule[0]).div(DENOMINATOR).div("30");
      var expectedNewSupply = oldSupply.add(vestingAmount).toString().slice(0, -3)

      expect(oldStep.add("1")).to.equal(newStep);
      expect(expectedNewSupply).to.equal(newSupply.toString().slice(0, -3));

      var chefBalance = await this.png.balanceOf(chef.address);
      var rewardsExpiration = await chef.rewardsExpiration();
      var rewardPerSecond = await chef.rewardPerSecond();

      var lastUpdate = await this.vester.lastUpdate();

      var expectedChefBalance = vestingAmount.mul(recipients[0].allocation).div(DENOMINATOR);
      var expectedRewardsExpiration = lastUpdate.add("86400");
      var expectedRewardPerSecond = expectedChefBalance.div("86400");

      expect(expectedChefBalance.toString().slice(0, -3)).to.equal(chefBalance.toString().slice(0, -3));
      expect(expectedRewardsExpiration).to.equal(rewardsExpiration);
      expect(expectedRewardPerSecond.toString().slice(0, -2)).to.equal(rewardPerSecond.toString().slice(0, -2));
    });

  });


  //////////////////////////////
  //     Vesting Simulation - cannot run submodules independently
  //////////////////////////////
  describe("Semi-Random Vesting Simulation", function () {
    it("sets up contract for vesting", async function () {
      this.recipients = generateRecipients(
        chance.integer({ min: 1, max: 20 }).toString(),
      );
      this.totalSupply = ethers.utils.parseUnits(
          chance.integer({ min: 10**6, max: 50*10**9 }).toString(),
          18
        );
      // Deploy PNG
      this.png = await this.Png.deploy(
        this.totalSupply, // max supply
        0, // initial mint
        "PNG",
        "Pangolin"
      );
      await this.png.deployed();
      // Deploy mock mini chef
      this.chef = await this.Chef.deploy(this.png.address,this.admin.address);
      await this.chef.deployed();
      this.recipients[0].isMiniChef = true;
      this.recipients[0].account = this.chef.address;
      // Deploy vester
      this.vester = await this.Vester.deploy(
          this.png.address,
          this.totalSupply,
          this.recipients,
          ethers.Wallet.createRandom().address // guardian
        );
      await this.vester.deployed();
      await this.png.grantRole(MINTER_ROLE, this.vester.address);
      await this.chef.addFunder(this.vester.address);
      await expect(this.vester.startVesting())
        .to.emit(
          this.vester,
          "VestingEnabled"
        );
    });

    // Distribute for 30 months
    for (let month = 0; month < 30; month++) {
      it("vests month " + (month + 1), async function () {
        for (let day = 0; day < 30; day++) {
          await expect(this.vester.distribute())
            .to.emit(this.vester, "TokensVested");
          await network.provider.send("evm_increaseTime", [86400]);
        };
        if (month == 0) {
          this.expectedBalance = BigNumber.from("0");
        }
        this.expectedBalance = this.expectedBalance.add(
          this.totalSupply
            .mul(distributionSchedule[month])
            .div(DENOMINATOR)
        );
        let balance = await this.png.totalSupply();
        expect(Math.floor(ethers.utils.formatUnits(this.expectedBalance, 15)))
          .to.equal(Math.floor(ethers.utils.formatUnits(balance, 15)));
      });
    };

    it("fails vesting after 30th month", async function () {
      await expect(this.vester.distribute())
        .to.be.revertedWith("TreasuryVester::distribute: vesting is over");
      let balance = await this.png.balanceOf(this.vester.address);
      expect(Math.floor(ethers.utils.formatUnits(balance, 15))).to.equal(0);
    });

    it("recipients got correct allocation", async function () {
      for (let i = 0; i < this.recipients.length; i++) {
        let balance = await this.png.balanceOf(this.recipients[i].account);
        let expectedBalance = this.totalSupply
          .mul(this.recipients[i].allocation)
          .div(DENOMINATOR);
        expect(Math.floor(ethers.utils.formatUnits(expectedBalance, 15)))
          .to.equal(Math.floor(ethers.utils.formatUnits(balance, 15)));
      }
    });


  });


});

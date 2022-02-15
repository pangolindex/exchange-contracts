const { expect } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");
const chance = require("chance").Chance();

const distributionSchedule = [ 2500, 1400, 800, 530, 390, 370, 350, 330, 310, 290, 270, 250, 235, 220, 205, 190, 175, 160, 145, 130, 120, 110, 100, 90, 80, 70, 60, 50, 40, 30 ];

function generateRecipients(recipientsLength) {
  let recipients = [];
  let totalAlloc = 0;
  let denominator = 10000;

  //let recipientsLength = chance.integer({ min: 1, max: 20 });
  for (let i = 0; i < recipientsLength; i++) {
    let account = ethers.Wallet.createRandom();
    let alloc;
    if (i === recipientsLength - 1) {
      alloc = denominator - totalAlloc;
    } else {
      alloc = chance.integer({
        min: 1,
        max: denominator - totalAlloc - (recipientsLength - i - 1)
      });
    }
    totalAlloc += alloc;
    recipients.push(
      {
        account: account.address,
        allocation: alloc
      }
    )
  };

  return recipients;

};


describe("TreasuryVester.sol", function () {
  before(async function () {
    this.denominator = BigNumber.from("10000");

    // Get addresses that might send transactions
    [ this.admin, this.unprivileged ] = await ethers.getSigners();

    // get contract factories
    this.Vester = await ethers.getContractFactory("TreasuryVester");
    this.Png = await ethers.getContractFactory("Png");
    this.Chef = await ethers.getContractFactory("MiniChefV2");

    this.recipients = generateRecipients(7);
    this.startingBalance = ethers.utils.parseUnits("218500000", 18);
    this.totalSupply = ethers.utils.parseUnits("230000000", 18);

    // Deploy PNG
    this.png = await this.Png.deploy(
      this.totalSupply, // max supply
      0, // initial mint
      "PNG",
      "Pangolin"
    );
    await this.png.deployed();

    // Deploy Treasury Vester
    this.vester = await this.Vester.deploy(
        this.png.address,
        this.startingBalance,
        this.recipients,
        ethers.Wallet.createRandom().address // guardian
      );
    await this.vester.deployed();

    await this.png.setMinter(this.vester.address);

  });

  describe("Access Control", function () {
    it("privileged can change admin", async function() {
      await expect(this.vester.setAdmin(this.unprivileged.address))
        .to.emit(this.vester, "AdminChanged");

      let vester = await this.vester.connect(this.unprivileged);
      await expect(vester.setAdmin(this.admin.address))
        .to.emit(this.vester, "AdminChanged");

    });

    it("unprivileged cannot change admin", async function() {
      let vester = await this.vester.connect(this.unprivileged);
      await expect(vester.setAdmin(this.admin.address))
        .to.be.revertedWith("unprivileged message sender");
    });

    it("unprivileged cannot change recipients", async function() {
      let vester = await this.vester.connect(this.unprivileged);
      await expect(vester.setRecipients(
        [{ account: this.unprivileged.address, allocation: this.denominator }]
      )).to.be.revertedWith("unprivileged message sender");
    });

    it("unprivileged cannot start vesting", async function() {
      let vester = await this.vester.connect(this.unprivileged);
      await expect(vester.startVesting())
        .to.be.revertedWith("unprivileged message sender");
    });

  });

  describe("Flow Control", function () {
    describe("when vesting is disabled", function () {
      it("cannot distribute when vesting disabled", async function() {
        await expect(this.vester.distribute())
          .to.be.revertedWith("vesting not enabled");
      });

    });

    // cannot run submodules separately
    describe("when vesting is enabled", function () {
      it("starts vesting", async function () {
        await expect(this.vester.startVesting())
          .to.emit(
            this.vester,
            "VestingEnabled"
          );
      });
      it("cannot distribute before vesting cliff", async function () {
        let vester = await this.vester.connect(this.unprivileged);
        await expect(vester.distribute()).to.emit(vester, "TokensVested");
        await network.provider.send("evm_increaseTime", [86398]);
        await expect(vester.distribute())
          .to.be.revertedWith("too early to distribute");
      });

    });

  });

  describe("Input Sanitization", function () {
    it("cannot set zero recipients", async function () {
      let recipients = generateRecipients(0);
      await expect(this.vester.setRecipients(recipients))
        .to.be.revertedWith("invalid recipient number");
    });

    it("cannot set more than twenty recipients", async function () {
      let recipients = generateRecipients(21);
      await expect(this.vester.setRecipients(recipients))
        .to.be.revertedWith("invalid recipient number");
    });

    it("cannot make zero address a recipient", async function () {
      let recipients = generateRecipients(4);
      recipients[2].account = ethers.constants.AddressZero;
      await expect(this.vester.setRecipients(recipients))
        .to.be.revertedWith("invalid recipient address");
    });

    it("cannot have zero allocation for a recipient", async function () {
      let recipients = generateRecipients(4);
      recipients[2].allocation = 0;
      await expect(this.vester.setRecipients(recipients))
        .to.be.revertedWith("invalid recipient allocation");
    });

    it("cannot have total alloc greater than denominator", async function () {
      let recipients = generateRecipients(4);
      recipients[2].allocation = recipients[2].allocation + 1;
      await expect(this.vester.setRecipients(recipients))
        .to.be.revertedWith("total allocations do not equal to denominator");
    });

    it("cannot have total alloc less than denominator", async function () {
      let recipients = generateRecipients(4);
      for (let i = 0; i < 4; i++) {
        if (recipients[i].allocation > 1) {
          recipients[i].allocation = recipients[i].allocation - 1;
          break;
        }
      }
      await expect(this.vester.setRecipients(recipients))
        .to.be.revertedWith("total allocations do not equal to denominator");
    });

    it("cannot set zero address as admin", async function () {
      await expect(this.vester.setAdmin(ethers.constants.AddressZero))
        .to.be.revertedWith("cannot set zero address as admin");
    });

  });

  // cannot run submodules separately
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
      await this.png.setMinter(this.vester.address);
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
            .div(this.denominator)
        );
        let balance = await this.png.totalSupply();
        expect(Math.floor(ethers.utils.formatUnits(this.expectedBalance, 15)))
          .to.equal(Math.floor(ethers.utils.formatUnits(balance, 15)));
      });
    };

    it("fails vesting after 30th month", async function () {
      await expect(this.vester.distribute())
        .to.be.revertedWith("Png::_mintTokens: mint result exceeds max supply");
      let balance = await this.png.balanceOf(this.vester.address);
      expect(Math.floor(ethers.utils.formatUnits(balance, 15))).to.equal(0);
    });

    it("recipients got correct allocation", async function () {
      for (let i = 0; i < this.recipients.length; i++) {
        let balance = await this.png.balanceOf(this.recipients[i].account);
        let expectedBalance = this.totalSupply
          .mul(this.recipients[i].allocation)
          .div(this.denominator);
        expect(Math.floor(ethers.utils.formatUnits(expectedBalance, 15)))
          .to.equal(Math.floor(ethers.utils.formatUnits(balance, 15)));
      }
    });


  });


});

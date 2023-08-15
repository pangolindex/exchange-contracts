// test/PNG.js
// Load dependencies
const { expect } = require('chai');
const { ethers } = require('hardhat');

const AIRDROP_SUPPLY = ethers.utils.parseUnits("11500000", 18);
const TOTAL_SUPPLY = ethers.utils.parseUnits("230000000", 18);
const ZERO_ADDRESS = ethers.constants.AddressZero;
const UINT96_MAX = ethers.BigNumber.from("2").pow("96").sub("1");
const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));

describe('PNG', function () {

  before(async function () {
    [ this.admin, ] = await ethers.getSigners();
    this.PNG = await ethers.getContractFactory("Png");
  });

  beforeEach(async function () {
    this.png = await this.PNG.deploy(TOTAL_SUPPLY, AIRDROP_SUPPLY, "Pangolin", "PNG");
    await this.png.deployed();
  });


  //////////////////////////////
  //     Constructor
  //////////////////////////////
  describe("Constructor", function () {
    it('arg 1: max supply', async function () {
      expect(await this.png.cap()).to.equal(TOTAL_SUPPLY);
    });
    it('arg 2: initial supply', async function () {
      expect(await this.png.totalSupply()).to.equal(AIRDROP_SUPPLY);
    });
    it('arg 3: symbol', async function () {
      expect(await this.png.symbol()).to.equal("PNG");
    });
    it('arg 4: name', async function () {
      expect(await this.png.name()).to.equal("Pangolin");
    });
    it('default: admin', async function () {
      expect(await this.png.hasRole(DEFAULT_ADMIN_ROLE, this.admin.address)).to.be.true;
    });
    it('default: minter', async function () {
      expect(await this.png.hasRole(MINTER_ROLE, this.admin.address)).to.be.false;
    });
  });


  //////////////////////////////
  //     mint
  //////////////////////////////
  describe("mint", function () {
    it('unauthorized cannot mint', async function() {
      await expect(this.png.mint(this.admin.address, 1)).to.be.reverted;
    });

    it('authorized can mint', async function() {
      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY);
      expect(await this.png.totalSupply()).to.equal(AIRDROP_SUPPLY);

      await expect(this.png.grantRole(MINTER_ROLE, this.admin.address)).to.emit(this.png, "RoleGranted");

      await expect(this.png.mint(this.admin.address, 1)).to.emit(this.png, "Transfer");

      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY.add("1"));
      expect(await this.png.totalSupply()).to.equal(AIRDROP_SUPPLY.add("1"));
      expect(await this.png.balanceOf(ZERO_ADDRESS)).to.equal(0);
    });

    it('cannot mint over max supply', async function() {
      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY);
      expect(await this.png.totalSupply()).to.equal(AIRDROP_SUPPLY);

      await expect(this.png.grantRole(MINTER_ROLE, this.admin.address)).to.emit(this.png, "RoleGranted");

      await expect(this.png.mint(this.admin.address, TOTAL_SUPPLY.sub(AIRDROP_SUPPLY).add("1"))).to.be.reverted;

      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY);
      expect(await this.png.totalSupply()).to.equal(AIRDROP_SUPPLY);
      expect(await this.png.balanceOf(ZERO_ADDRESS)).to.equal(0);
    });

    it('cannot mint to zero address', async function() {
      expect(await this.png.balanceOf(ZERO_ADDRESS)).to.equal("0");
      expect(await this.png.totalSupply()).to.equal(AIRDROP_SUPPLY);

      await expect(this.png.grantRole(MINTER_ROLE, this.admin.address)).to.emit(this.png, "RoleGranted");

      await expect(this.png.mint(ZERO_ADDRESS, 1)).to.be.reverted;

      expect(await this.png.totalSupply()).to.equal(AIRDROP_SUPPLY);
      expect(await this.png.balanceOf(ZERO_ADDRESS)).to.equal(0);
    });

    it('cannot mint above 96 bits', async function() {
      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY);
      expect(await this.png.totalSupply()).to.equal(AIRDROP_SUPPLY);

      await expect(this.png.grantRole(MINTER_ROLE, this.admin.address)).to.emit(this.png, "RoleGranted");

      await expect(this.png.mint(this.admin.address, UINT96_MAX.sub(AIRDROP_SUPPLY).add("1"))).to.be.reverted;

      expect(await this.png.totalSupply()).to.equal(AIRDROP_SUPPLY);
      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY);
    });

  });


  //////////////////////////////
  //     burn
  //////////////////////////////
  describe("burn", function () {
    it('cannot burn above 96 bits', async function() {
      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY);

      await expect(this.png.burn(UINT96_MAX.add("1"))).to.be.reverted;

      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY);
    });

    it('cannot burn more than balance', async function() {
      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY);

      await expect(this.png.burn(AIRDROP_SUPPLY.add("1"))).to.be.reverted;

      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY);
    });

    it('burns balance', async function() {
      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY);

      await expect(this.png.burn(AIRDROP_SUPPLY)).to.emit(this.png, "Transfer");

      expect(await this.png.totalSupply()).to.equal("0");
      expect(await this.png.balanceOf(this.admin.address)).to.equal("0");
    });

    /* TODO Should also check changes due to _moveDelegates */

  });


  //////////////////////////////
  //     burnFrom
  //////////////////////////////
  describe("burnFrom", function () {
    it('cannot burn above 96 bits', async function() {
      [ , altAddr] = await ethers.getSigners();
      altContract = await this.png.connect(altAddr);

      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY);

      await expect(altContract.burnFrom(this.admin.address, UINT96_MAX.add("1"))).to.be.reverted;

      expect(await this.png.totalSupply()).to.equal(AIRDROP_SUPPLY);
      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY);
    });

    it('cannot burn without allowance', async function() {
      [ , altAddr] = await ethers.getSigners();
      altContract = await this.png.connect(altAddr);

      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY);

      await expect(altContract.burnFrom(this.admin.address, "1")).to.be.reverted;

      expect(await this.png.totalSupply()).to.equal(AIRDROP_SUPPLY);
      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY);
    });

    it('can burn with allowance', async function() {
      [ , altAddr] = await ethers.getSigners();
      altContract = await this.png.connect(altAddr);

      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY);

      await expect(this.png.approve(altAddr.address, AIRDROP_SUPPLY)).to.emit(this.png, "Approval");
      expect(await this.png.allowance(this.admin.address, altAddr.address)).to.equal(AIRDROP_SUPPLY);

      await expect(altContract.burnFrom(this.admin.address, AIRDROP_SUPPLY)).to.emit(this.png, "Transfer");

      expect(await this.png.balanceOf(this.admin.address)).to.equal("0");
      expect(await this.png.totalSupply()).to.equal("0");
      expect(await this.png.allowance(this.admin.address, altAddr.address)).to.equal("0");
    });

    it('cannot burn more than balance', async function() {
      [ , altAddr] = await ethers.getSigners();
      altContract = await this.png.connect(altAddr);

      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY);

      await expect(this.png.approve(altAddr.address, UINT96_MAX)).to.emit(this.png, "Approval");
      expect(await this.png.allowance(this.admin.address, altAddr.address)).to.equal(UINT96_MAX);

      await expect(altContract.burnFrom(this.admin.address, AIRDROP_SUPPLY.add("1"))).to.be.reverted;

      expect(await this.png.balanceOf(this.admin.address)).to.equal(AIRDROP_SUPPLY);
      expect(await this.png.totalSupply()).to.equal(AIRDROP_SUPPLY);
      expect(await this.png.allowance(this.admin.address, altAddr.address)).to.equal(UINT96_MAX);
    });

    /* TODO Should also check changes due to _moveDelegates */

  });


  //////////////////////////////
  //     setMinter
  //////////////////////////////
  describe("setMinter", function () {
    it('admin set minter', async function() {
      expect(await this.png.hasRole(MINTER_ROLE, this.admin.address)).to.be.false;

      await expect(this.png.grantRole(MINTER_ROLE, this.admin.address)).to.emit(this.png, "RoleGranted");

      expect(await this.png.hasRole(MINTER_ROLE, this.admin.address)).to.be.true;
    });

    it('unauthorized cannot set minter', async function() {
      [ , altAddr] = await ethers.getSigners();
      altContract = await this.png.connect(altAddr);

      expect(await this.png.hasRole(MINTER_ROLE, altAddr.address)).to.be.false;

      await expect(altContract.grantRole(MINTER_ROLE, altAddr.address)).to.be.reverted;

      expect(await this.png.hasRole(MINTER_ROLE, altAddr.address)).to.be.false;
    });

  });


  //////////////////////////////
  //     setAdmin
  //////////////////////////////
  describe("setAdmin", function () {
    it('admin can set admin', async function() {
      [ , altAddr] = await ethers.getSigners();

      expect(await this.png.hasRole(DEFAULT_ADMIN_ROLE, this.admin.address)).to.be.true;

      await expect(this.png.grantRole(DEFAULT_ADMIN_ROLE, altAddr.address)).to.emit(this.png, "RoleGranted");

      expect(await this.png.hasRole(DEFAULT_ADMIN_ROLE, altAddr.address)).to.be.true;
    });

    it('unauthorized cannot set admin', async function() {
      [ , altAddr] = await ethers.getSigners();
      altContract = await this.png.connect(altAddr);

      expect(await this.png.hasRole(DEFAULT_ADMIN_ROLE, this.admin.address)).to.be.true;

      await expect(altContract.grantRole(DEFAULT_ADMIN_ROLE, altAddr.address)).to.be.reverted;

      expect(await this.png.hasRole(DEFAULT_ADMIN_ROLE, altAddr.address)).to.be.false;
    });

    it('cannot remove admin', async function() {
      expect(await this.png.hasRole(DEFAULT_ADMIN_ROLE, this.admin.address)).to.be.true;

      await expect(this.png.revokeRole(DEFAULT_ADMIN_ROLE, this.admin.address)).to.emit(this.png, "RoleRevoked");

      expect(await this.png.hasRole(DEFAULT_ADMIN_ROLE, this.admin.address)).to.be.false;
    });

  });
});

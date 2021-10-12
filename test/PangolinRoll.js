const chai = require("chai");
const { ethers } = require("hardhat");
const { expect } = chai;

const Pangolin = {
    Router: "0xE54Ca86531e17Ef3616d22Ca28b0D458b6C89106",
    Pairs: {
        USDT: {
            DAI: "0x485e264903e584e1a41b80eb842470da9d47e764",
        }
    }
}

const TraderJoe = {
    Router: "0x60aE616a2155Ee3d9A68541Ba4544862310933d4",
    Pairs: {
        USDT: {
            DAI: "0x943edd46fb9573a0b0517c0ce010791bd5ca0a15",
        }
    }
}

const Tokens = {
    WAVAX: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
    USDT: "0xde3a24028580884448a5397872046a019649b084",
    DAI: "0xba7deebbfc5fa1100fb055a87773e1e99cd3507a",
}

const units = (amount, decimal = 18) => {
    return ethers.BigNumber.from(amount.toString()).mul(
        ethers.BigNumber.from(10).pow(decimal)
    );
};

describe("PangolinRoll", () => {
    let owner;
    let token0, token1;
    let pangolinRoll;
    let pangolinRouter, joeRouter;
    let now;

    before(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];

        token0 = await ethers.getContractAt("contracts/pangolin-core/test/ERC20.sol:ERC20", Tokens.USDT, owner)
        token1 = await ethers.getContractAt("contracts/pangolin-core/test/ERC20.sol:ERC20", Tokens.DAI, owner)

        pangolinRouter = await ethers.getContractAt("IPangolinRouter", Pangolin.Router, owner)
        joeRouter = await ethers.getContractAt("IPangolinRouter", TraderJoe.Router, owner)

        const PangolinRoll = await ethers.getContractFactory("PangolinRoll")
        pangolinRoll = await PangolinRoll.deploy(joeRouter.address, pangolinRouter.address)
        await pangolinRoll.deployed();
    });

    it("Should prepare Joe USDT-DAI LP", async () => {
        now = Math.floor(new Date().getTime() / 1000)
        // get USDT
        await pangolinRouter.swapAVAXForExactTokens(units(1000, 6), [
            Tokens.WAVAX,
            Tokens.USDT,
        ], owner.address, now + 1000, {
            value: units(100)
        })

        // get DAI
        await pangolinRouter.swapAVAXForExactTokens(units(1000), [
            Tokens.WAVAX,
            Tokens.DAI,
        ], owner.address, now + 1000, {
            value: units(100)
        })

        await token0.approve(joeRouter.address, units(1000, 6))
        await token1.approve(joeRouter.address, units(1000))
        await joeRouter.addLiquidity(token0.address, token1.address, units(100, 6).toString(), units(100), 1, 1, owner.address, now + 1000);
    });

    it("should migrate USDT-DAI LP from Joe to Pangolin", async () => {
        now = Math.floor(new Date().getTime() / 1000)
        const joelpToken = await ethers.getContractAt("contracts/pangolin-core/test/ERC20.sol:ERC20", TraderJoe.Pairs.USDT.DAI)

        const balance = await joelpToken.balanceOf(owner.address)
        console.log(balance.toString())
        await joelpToken.approve(pangolinRoll.address, balance)

        await pangolinRoll.migrate(token0.address, token1.address, balance, 0, 0, now + 1000)
        expect(await joelpToken.balanceOf(owner.address)).to.equal(0)

        const pangolinlpToken = await ethers.getContractAt("contracts/pangolin-core/test/ERC20.sol:ERC20", Pangolin.Pairs.USDT.DAI)
        expect(await pangolinlpToken.balanceOf(owner.address)).to.gt(0)
    })
})
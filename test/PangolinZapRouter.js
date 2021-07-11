const { expect } = require("chai")
const { ethers } = require("hardhat")
const { makeAccountGenerator, fundToken, fundWAVAX, getTokenContract, getPairContract, getWAVAXContract, getDeadline} = require("./utils")
const fixture = require('./fixture.json')
const hardhat = require("hardhat")


describe("ZapRouter", async function() {

    before(async () => {
        await hardhat.run("compile")
    })

    let accountGenerator;
    let owner;
    let WAVAX;
    let account;

    beforeEach(async () => {    
        accountGenerator = await makeAccountGenerator()
        owner = await accountGenerator()
        account = await accountGenerator()
        WAVAX = await getWAVAXContract()
        //this is necessary, the asserts funds the account on the assumption it has 0 WAVAX
        await WAVAX.connect(account).withdraw(await WAVAX.balanceOf(account.address))
    })

    it("Router can be deployed", async function() {
        const factory = await ethers.getContractFactory("PangolinZapRouter")
        const zapRouter = await factory.connect(owner).deploy(fixture.Factory, fixture.Router)
        await zapRouter.deployed()
        expect(await zapRouter.factory()).to.equal(fixture.Factory)
        expect(await zapRouter.swapRouter()).to.equal(fixture.Router)
    })

    it("Router can convert AVAX-WBTC to AVAX-ETH", async function() {
        const AVAX_BTC_Pair = await getPairContract(fixture.Pairs.AVAX.WBTC)
        const AVAX_ETH_Pair = await getPairContract(fixture.Pairs.AVAX.ETH)
        const BTCERC20 = await getTokenContract(fixture.Tokens.AEB_WBTC)

        const factory = await ethers.getContractFactory("PangolinZapRouter")
        const zapRouter = await factory.connect(owner).deploy(fixture.Factory, fixture.Router)
        await zapRouter.deployed()

        const bn10 = ethers.BigNumber.from(10)
        const amountAvax = bn10.pow(28)
        // funds 10000000e28*2 WAVAX
        await fundWAVAX(account, amountAvax.mul(2))
        // uses half of the WAVAX(10000000e28) to fund BTC
        let amountBTC = await fundToken(account, fixture.Tokens.AEB_WBTC, amountAvax)
        let [reserves0, reserves1] = await AVAX_BTC_Pair.getReserves()
        if (AVAX_BTC_Pair != fixture.Tokens.AEB_WBTC) [reserves0, reserves1] = [reserves1, reserves0]
        expect(await BTCERC20.balanceOf(account.address)).to.equal(amountBTC)
        expect(await WAVAX.balanceOf(account.address)).to.equal(amountAvax)

        // funds the liquidity token
        await BTCERC20.connect(account).transfer(AVAX_BTC_Pair.address, amountBTC)
        await WAVAX.connect(account).transfer(AVAX_BTC_Pair.address, amountAvax)
        await AVAX_BTC_Pair.connect(account).mint(account.address)
        let liquidityAmount = await AVAX_BTC_Pair.balanceOf(account.address)
        expect(liquidityAmount).to.gt(0)
        
        let previousBTCBalance = await BTCERC20.balanceOf(account.address)
        let previousWAVAXBalance = await WAVAX.balanceOf(account.address)
        
        // converts the AVAX-BTC into AVAX-ETH
        await AVAX_BTC_Pair.connect(account).approve(zapRouter.address, ethers.constants.MaxUint256)
        await zapRouter.connect(account).convertLiquidity(
            AVAX_BTC_Pair.address,
            fixture.Pairs.AVAX.ETH,
            account.address,
            liquidityAmount,
            getDeadline()
        )
        expect(await AVAX_ETH_Pair.balanceOf(account.address)).to.gt(0)
        let BTCBalance = await BTCERC20.balanceOf(account.address)
        let WAVAXBalance = await WAVAX.balanceOf(account.address)
        //assert that the charge was sent back
        expect(BTCBalance).to.gte(previousBTCBalance)
        expect(WAVAXBalance).to.gte(previousWAVAXBalance)
        //asert there's no dust on the contract
        expect(await BTCERC20.balanceOf(zapRouter.address)).to.equal(0)
        expect(await WAVAX.balanceOf(zapRouter.address)).to.equal(0)
        expect(await AVAX_ETH_Pair.balanceOf(zapRouter.address)).to.equal(0)
        expect(await AVAX_BTC_Pair.balanceOf(zapRouter.address)).to.equal(0)
    })

});

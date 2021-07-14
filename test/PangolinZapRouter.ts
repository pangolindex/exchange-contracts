import { expect } from "chai"
import { ethers } from "hardhat"
import { checkDust, makeAccountGenerator, fundLiquidityToken, getTokenContract, getPairContract, getWAVAXContract, getDeadline} from "./utils"
import fixture from './fixture'
import {run} from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { Contract } from "@ethersproject/contracts"
import { BigNumber } from "ethers"


describe("ZapRouter", async function() {

    before(async () => {
        await run("compile")
    })

    let accountGenerator: ()=>SignerWithAddress;
    let owner: SignerWithAddress;
    let WAVAX: Contract;
    let account: SignerWithAddress;

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
        const bn10 = BigNumber.from(10)
        const avaxAmount = bn10.pow(28)

        let liquidityAmount = await fundLiquidityToken(account, AVAX_BTC_Pair.address, avaxAmount)
        
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
        checkDust([BTCERC20.address, WAVAX.address, AVAX_ETH_Pair.address, AVAX_BTC_Pair.address], zapRouter.address, 0)
    })

});

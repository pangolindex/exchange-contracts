import { expect } from "chai"
import { ethers } from "hardhat"
import { checkDust, makeAccountGenerator, fundLiquidityToken, getTokenContract, getPairContract, getWAVAXContract, getDeadline, fundToken, fundWAVAX} from "./utils"
import fixture from './fixture'
import {run} from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { Contract } from "@ethersproject/contracts"
import { BigNumber, ContractFactory } from "ethers"


describe("BridgeMigrationRouter", async function() {

    let accountGenerator: ()=>SignerWithAddress
    let owner: SignerWithAddress
    let account: SignerWithAddress

    before(async () => {
        await run("compile")
    })

    
    let WAVAX: Contract
    let factory: ContractFactory
    let migrationRouter: Contract
    
    type MigratorTokenSymbol = keyof typeof fixture.Migrators
    type TokenSymbol = keyof typeof fixture.Tokens
    type AVAXPairsTokenSymbol = keyof typeof fixture.Pairs.AVAX
    type PNGPairsTokenSymbol = keyof typeof fixture.Pairs.PNG

    beforeEach(async () => {
        accountGenerator = await makeAccountGenerator()
        owner = accountGenerator()
        account = accountGenerator()
        WAVAX = await getWAVAXContract()
        //this is necessary, the asserts funds the account on the assumption it has 0 WAVAX
        await WAVAX.connect(account).withdraw(await WAVAX.balanceOf(account.address))
        factory = await ethers.getContractFactory("PangolinBridgeMigrationRouter")
        migrationRouter = await factory.connect(owner).deploy()
        await migrationRouter.deployed()
        await fundWAVAX(account, BigNumber.from(10).pow(24))
    })

    it("Can be deployed", async function() {
        expect(await migrationRouter.connect(owner).isAdmin(owner.address)).to.be.true;
    })

    it("Admin can add admin", async function() {
        await migrationRouter.connect(owner).addAdmin(account.address)
        expect(await migrationRouter.connect(owner).isAdmin(account.address)).to.be.true;
    })

    it("Admin can remove admin", async function() {
        await migrationRouter.connect(owner).addAdmin(account.address)
        expect(await migrationRouter.connect(owner).isAdmin(account.address)).to.be.true;
        await migrationRouter.connect(owner).removeAdmin(account.address)
        expect(await migrationRouter.connect(owner).isAdmin(account.address)).to.be.false;
    })

    it("Others can't add admin", async function() {
        expect(await migrationRouter.connect(owner).isAdmin(account.address)).to.be.false;
        await expect(migrationRouter.connect(account).addAdmin(account.address)).to.be.reverted;
        expect(await migrationRouter.isAdmin(account.address)).to.be.false;
    })

    it("Others can't remove admin", async function() {
        expect(await migrationRouter.connect(owner).isAdmin(account.address)).to.be.false;
        await expect(migrationRouter.connect(account).removeAdmin(owner.address)).to.be.reverted;
        expect(await migrationRouter.isAdmin(owner.address)).to.be.true;
    })

    it("Others can't check admin", async function() {
        expect(await migrationRouter.connect(owner).isAdmin(account.address)).to.be.false;
        await expect(migrationRouter.connect(account).isAdmin(owner.address)).to.be.reverted;
    })

    it("Admin can't add migrator incompatible with the token", async function() {
        await expect(migrationRouter.connect(owner).addMigrator(fixture.Tokens.WAVAX, fixture.Migrators.WBTC)).to.be.reverted;
    })

    for(let tokenSymbol of Object.keys(fixture.Migrators)) {
        let tokenAddress = fixture.Tokens[tokenSymbol as TokenSymbol]
        let migrator = fixture.Migrators[tokenSymbol as MigratorTokenSymbol]
        
        it(`Admin can add migrator for ${tokenSymbol}`, async function() {
            await migrationRouter.connect(owner).addMigrator(tokenAddress, migrator)
            expect((await migrationRouter.bridgeMigrator(tokenAddress)).toString().toLowerCase()).to.equal(migrator.toLowerCase())
        })
        it(`Can migrate for token ${tokenSymbol}`, async function() {
            await migrationRouter.connect(owner).addMigrator(tokenAddress, migrator)
            expect((await migrationRouter.bridgeMigrator(tokenAddress)).toString().toLowerCase()).to.equal(migrator.toLowerCase())
            let tokenAmount = await fundToken(account, tokenAddress, BigNumber.from(10).pow(18))
            await migrationRouter.connect(account).migrateToken(tokenAddress, account.address, tokenAmount, getDeadline())
            let migratedTokenAddress = await migrationRouter.bridgeMigrator(tokenAddress)
            let migratedToken = await getTokenContract(migratedTokenAddress)
            expect(await migratedToken.balanceOf(account.address)).to.be.equal(tokenAmount)
        })
    }
    
    for(let tokenSymbol of Object.keys(fixture.Migrators)) {
        let tokenAddress = fixture.Tokens[tokenSymbol as TokenSymbol]
        let migrator = fixture.Migrators[tokenSymbol as MigratorTokenSymbol]
        it(`Others can't add migrator for ${tokenSymbol}`, async function() {
            await expect(migrationRouter.connect(account).addMigrator(tokenAddress, migrator)).to.be.reverted
            expect((await migrationRouter.bridgeMigrator(tokenAddress)).toString().toLowerCase()).to.equal("0x0000000000000000000000000000000000000000");
        })
    }

    for(let tokenSymbol of Object.keys(fixture.Migrators)) {
        let tokenAddress = fixture.Tokens[tokenSymbol as TokenSymbol]
        let migrator = fixture.Migrators[tokenSymbol as MigratorTokenSymbol]
        if (!(tokenSymbol in fixture.Pairs.AVAX)) continue
        let pairAddress = fixture.Pairs.AVAX[tokenSymbol as AVAXPairsTokenSymbol]
        let toPairAddress = fixture.Pairs.Migrated.AVAX[tokenSymbol as AVAXPairsTokenSymbol]
        it(`Can migrate liquidity from AVAX-${tokenSymbol}`, async function() {
            await migrationRouter.connect(owner).addMigrator(tokenAddress, migrator)
            let liquidityAmount = await fundLiquidityToken(account, pairAddress, BigNumber.from(10).pow(22))
            await migrationRouter.migrateLiquidity(pairAddress, toPairAddress, account.address, liquidityAmount, getDeadline())
            let migratedPair = await getPairContract(toPairAddress);
            expect(await migratedPair.balanceOf(account.address)).to.equal(liquidityAmount);
        })
    }

    
    for(let tokenSymbol of Object.keys(fixture.Migrators)) {
        let tokenAddress = fixture.Tokens[tokenSymbol as TokenSymbol]
        let migrator = fixture.Migrators[tokenSymbol as MigratorTokenSymbol]
        if (!(tokenSymbol in fixture.Pairs.PNG)) continue
        let pairAddress = fixture.Pairs.PNG[tokenSymbol as PNGPairsTokenSymbol]
        let toPairAddress = fixture.Pairs.Migrated.PNG[tokenSymbol as PNGPairsTokenSymbol]
        it(`Can migrate liquidity from PNG-${tokenSymbol}`, async function() {
            await migrationRouter.connect(owner).addMigrator(tokenAddress, migrator)
            let liquidityAmount = await fundLiquidityToken(account, pairAddress, BigNumber.from(10).pow(22))
            await migrationRouter.migrateLiquidity(pairAddress, toPairAddress, account.address, liquidityAmount, getDeadline())
            let migratedPair = await getPairContract(toPairAddress);
            expect(await migratedPair.balanceOf(account.address)).to.equal(liquidityAmount);
        })
    }

});

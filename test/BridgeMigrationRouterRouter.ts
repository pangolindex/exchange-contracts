import { expect } from "chai"
import { ethers } from "hardhat"
import { 
    getOwnerAccount,
    makeAccountGenerator,
    fundLiquidityToken,
    getTokenContract,
    getPairContract,
    getWAVAXContract,
    getDeadline,
    fundToken,
    fundWAVAX
} from "./utils"
import fixture from './fixture'
import {run} from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { Contract } from "@ethersproject/contracts"
import { BigNumber, ContractFactory } from "ethers"


describe("BridgeMigrationRouter", async function() {

    let accountGenerator: ()=>SignerWithAddress
    let owner: SignerWithAddress
    let account: SignerWithAddress
    let WAVAX: Contract
    let factory: ContractFactory
    let migrationRouter: Contract
    type MigratorTokenSymbol = keyof typeof fixture.Migrators
    type TokenSymbol = keyof typeof fixture.Tokens
    type AVAXPairsTokenSymbol = keyof typeof fixture.Pairs.AVAX
    type AVAXMigratedPairsTokenSymbol = keyof typeof fixture.Pairs.Migrated.AVAX
    type PNGPairsTokenSymbol = keyof typeof fixture.Pairs.PNG
    type PNGMigratedPairsTokenSymbol = keyof typeof fixture.Pairs.Migrated.PNG

    before(async () => {
        await run("compile")
        accountGenerator = await makeAccountGenerator()
        const bridgeTokenFactory = await ethers.getContractFactory("BridgeToken")
        owner = await getOwnerAccount()
        WAVAX = await getWAVAXContract()
        const factory = await ethers.getContractAt("PangolinFactory", fixture.Factory)
        const router = await ethers.getContractAt("PangolinRouter", fixture.Router)

        await fundWAVAX(owner, BigNumber.from(10).pow(28))
        await fundToken(owner, fixture.Tokens.PNG, BigNumber.from(10).pow(25))
        await (await getTokenContract(fixture.Tokens.WAVAX)).approve(router.address, ethers.constants.MaxUint256)
        await (await getTokenContract(fixture.Tokens.PNG)).approve(router.address, ethers.constants.MaxUint256)
        
        // in case we don't have the migrator deployed, it deploys migrators
        for(let tokenSymbol of Object.keys(fixture.Migrators)) {
            let tokenAddress = fixture.Tokens[tokenSymbol as TokenSymbol]
            if (fixture.Migrators[tokenSymbol as MigratorTokenSymbol] !== "") {
                continue
            }
            let bridgeToken = await bridgeTokenFactory.deploy()
            await bridgeToken.deployed
            await bridgeToken.addSwapToken(tokenAddress, ethers.constants.MaxUint256)
            fixture.Migrators[tokenSymbol as MigratorTokenSymbol] = bridgeToken.address
            await bridgeToken.connect(owner).mint(
                owner.address,
                BigNumber.from("1000000000000000000000000000000000"),
                "0xc7198437980c041c805a1edcba50c1ce5db95118", 0,
                ethers.utils.formatBytes32String("test")
            )
            await bridgeToken.connect(owner).approve(router.address, ethers.constants.MaxUint256)
        }

        // if there's no pairs in the migrators, create the pairs and add liquidity for AVAX pairs
        for(let tokenSymbol of Object.keys(fixture.Pairs.Migrated.AVAX)) {
            let tokenAddress = fixture.Migrators[tokenSymbol as MigratorTokenSymbol]
            if (!tokenAddress) continue
            if (fixture.Pairs.Migrated.AVAX[tokenSymbol as AVAXMigratedPairsTokenSymbol] !== "") {
                continue
            }
            const price = BigNumber.from("1000000000000000000")
            if (await factory.getPair(fixture.Tokens.WAVAX, tokenAddress) == ethers.constants.AddressZero) {
                await router.connect(owner).addLiquidity(
                    fixture.Tokens.WAVAX, tokenAddress,
                    price, price.mul(2), price, price.mul(2),
                    owner.address, getDeadline()
                )
            }
            
            fixture.Pairs.Migrated.AVAX[tokenSymbol as AVAXMigratedPairsTokenSymbol] = await factory.getPair(fixture.Tokens.WAVAX, tokenAddress)
        }

        // if there's no pairs in the migrators, create the pairs and add liquidity for PNG pairs
        for(let tokenSymbol of Object.keys(fixture.Pairs.Migrated.PNG)) {
            let tokenAddress = fixture.Migrators[tokenSymbol as MigratorTokenSymbol]
            if (!tokenAddress) continue
            if (fixture.Pairs.Migrated.PNG[tokenSymbol as PNGMigratedPairsTokenSymbol] !== "") {
                continue
            }
            const price = BigNumber.from("1000000000000000000")
            await router.connect(owner).addLiquidity(
                fixture.Tokens.PNG, tokenAddress,
                price, price.mul(2), price, price.mul(2),
                owner.address, getDeadline()
            )

            let bn0 = BigNumber.from(fixture.Tokens.PNG)
            let bn1 = BigNumber.from(tokenAddress)

            let [token0, token1] = bn0.gt(bn1) ? [bn1.toHexString(), bn0.toHexString()] : [bn0.toHexString(), bn1.toHexString()]
            fixture.Pairs.Migrated.PNG[tokenSymbol as PNGMigratedPairsTokenSymbol] = await factory.getPair(token0, token1)
        }
    })

    beforeEach(async () => {
        account = accountGenerator()
        //this is necessary, the asserts funds the account on the assumption it has 0 WAVAX
        await WAVAX.connect(account).withdraw(await WAVAX.balanceOf(account.address))
        factory = await ethers.getContractFactory("PangolinBridgeMigrationRouter")
        migrationRouter = await factory.connect(owner).deploy()
        await migrationRouter.deployed()
        await fundWAVAX(account, BigNumber.from(10).pow(26))

    })

    describe("Administration", async function() {
        it("Can be deployed", async function() {
            expect(await migrationRouter.connect(owner).isAdmin(owner.address)).to.be.true
        })

        it("Admin can add admin", async function() {
            await migrationRouter.connect(owner).addAdmin(account.address)
            expect(await migrationRouter.connect(owner).isAdmin(account.address)).to.be.true
        })

        it("Admin can remove admin", async function() {
            await migrationRouter.connect(owner).addAdmin(account.address)
            expect(await migrationRouter.connect(owner).isAdmin(account.address)).to.be.true
            await migrationRouter.connect(owner).removeAdmin(account.address)
            expect(await migrationRouter.connect(owner).isAdmin(account.address)).to.be.false
        })

        it("Others can't add admin", async function() {
            expect(await migrationRouter.connect(owner).isAdmin(account.address)).to.be.false
            await expect(migrationRouter.connect(account).addAdmin(account.address)).to.be.reverted
            expect(await migrationRouter.isAdmin(account.address)).to.be.false
        })

        it("Others can't remove admin", async function() {
            expect(await migrationRouter.connect(owner).isAdmin(account.address)).to.be.false
            await expect(migrationRouter.connect(account).removeAdmin(owner.address)).to.be.reverted
            expect(await migrationRouter.isAdmin(owner.address)).to.be.true
        })

        it("Others can't check admin", async function() {
            expect(await migrationRouter.connect(owner).isAdmin(account.address)).to.be.false
            expect(await migrationRouter.connect(account).isAdmin(owner.address)).to.be.true
        })

        it("Admin can't add migrator incompatible with the token", async function() {
            await expect(migrationRouter.connect(owner).addMigrator(fixture.Tokens.WAVAX, fixture.Migrators.WBTC)).to.be.reverted
        })

        for(let tokenSymbol of Object.keys(fixture.Migrators)) {
            let tokenAddress = fixture.Tokens[tokenSymbol as TokenSymbol]
            let migrator = fixture.Migrators[tokenSymbol as MigratorTokenSymbol]
            it(`Others can't add migrator for ${tokenSymbol}`, async function() {
                await expect(migrationRouter.connect(account).addMigrator(tokenAddress, migrator)).to.be.reverted
                expect((await migrationRouter.bridgeMigrator(tokenAddress)).toString().toLowerCase()).to.equal(ethers.constants.AddressZero)
            })
        }

        for(let tokenSymbol of Object.keys(fixture.Migrators)) {
            let tokenAddress = fixture.Tokens[tokenSymbol as TokenSymbol]
            it(`Admin can add migrator for ${tokenSymbol}`, async function() {
                let migrator = fixture.Migrators[tokenSymbol as MigratorTokenSymbol]
                await migrationRouter.connect(owner).addMigrator(tokenAddress, migrator)
                expect((await migrationRouter.bridgeMigrator(tokenAddress)).toString().toLowerCase()).to.equal(migrator.toLowerCase())
            })
        }
    })

    describe("Token Migration", async function() {
        for(let tokenSymbol of Object.keys(fixture.Migrators)) {
            let tokenAddress = fixture.Tokens[tokenSymbol as TokenSymbol]

            it(`Any can migrate for token ${tokenSymbol}`, async function() {
                let migrator = fixture.Migrators[tokenSymbol as MigratorTokenSymbol]
                await migrationRouter.connect(owner).addMigrator(tokenAddress, migrator)
                expect((await migrationRouter.bridgeMigrator(tokenAddress)).toString().toLowerCase()).to.equal(migrator.toLowerCase())

                //fund the token and allow the contract to spend on the "account"s behalf
                let tokenAmount = await fundToken(account, tokenAddress, BigNumber.from(10).pow(18))
                let tokenContract = await getTokenContract(tokenAddress)
                await tokenContract.connect(account).approve(migrationRouter.address, ethers.constants.MaxInt256)

                await migrationRouter.connect(account).migrateToken(tokenAddress, account.address, tokenAmount, getDeadline())
                let migratedTokenAddress = await migrationRouter.bridgeMigrator(tokenAddress)
                let migratedToken = await getTokenContract(migratedTokenAddress)
                expect(await migratedToken.balanceOf(account.address)).to.be.equal(tokenAmount)
            })
        }
    })

    describe("Liquidity Migration", async function() {
        describe("AVAX", async function () {
            for(let tokenSymbol of Object.keys(fixture.Migrators)) {
                let tokenAddress = fixture.Tokens[tokenSymbol as TokenSymbol]
                if (!((tokenSymbol as AVAXPairsTokenSymbol) in fixture.Pairs.AVAX)) continue
                if (fixture.TokensWithoutFund.includes(tokenSymbol)) continue
                it(`Can migrate liquidity from AVAX-${tokenSymbol}`, async function() {
                    let pairAddress = fixture.Pairs.AVAX[tokenSymbol as AVAXPairsTokenSymbol]
                    let toPairAddress = fixture.Pairs.Migrated.AVAX[tokenSymbol as AVAXMigratedPairsTokenSymbol]
                    let migrator = fixture.Migrators[tokenSymbol as MigratorTokenSymbol]
                    let fromPairContract = await getTokenContract(pairAddress)
                    await migrationRouter.connect(owner).addMigrator(tokenAddress, migrator)
                    let liquidityAmount = await fundLiquidityToken(account, pairAddress, BigNumber.from(10).pow(20))
                    await fromPairContract.connect(account).approve(migrationRouter.address, ethers.constants.MaxUint256)
                    let migratedPair = await getPairContract(toPairAddress);
                    expect(await migratedPair.balanceOf(account.address)).to.equal(0)
                    await migrationRouter.connect(account).migrateLiquidity(pairAddress, toPairAddress, account.address, liquidityAmount, getDeadline())
                    expect(await migratedPair.balanceOf(account.address)).to.gt(0)
                    
                    //makes sure there's no dust left in the migration router
                    let token0 = await getTokenContract(await migratedPair.token0())
                    let token1 = await getTokenContract(await migratedPair.token1())
                    expect(await token0.balanceOf(migrationRouter.address)).to.equal(0)
                    expect(await token1.balanceOf(migrationRouter.address)).to.equal(0)
                    expect(await migratedPair.balanceOf(migrationRouter.address)).to.equal(0)
                    expect(await fromPairContract.balanceOf(migrationRouter.address)).to.equal(0)

                })
                it(`Can compute accurately chargeback from AVAX-${tokenSymbol}`, async function() {
                    let pairAddress = fixture.Pairs.AVAX[tokenSymbol as AVAXPairsTokenSymbol]
                    let toPairAddress = fixture.Pairs.Migrated.AVAX[tokenSymbol as AVAXMigratedPairsTokenSymbol]
                    let migrator = fixture.Migrators[tokenSymbol as MigratorTokenSymbol]
                    await migrationRouter.connect(owner).addMigrator(tokenAddress, migrator)
                    let liquidityAmount = await fundLiquidityToken(account, pairAddress, BigNumber.from(10).pow(20))
                    let toPairContract = await getPairContract(toPairAddress)
                    
                    // reads the chargeback
                    let [chargeBack0, chargeBack1] = await migrationRouter.calculateChargeBack(pairAddress, toPairAddress, liquidityAmount)
                    // reads the previous balance to compute the real charge back
                    let token0 = await getTokenContract(await toPairContract.token0())
                    let token1 = await getTokenContract(await toPairContract.token1())
                    let previousBalance0 = await token0.balanceOf(account.address)
                    let previousBalance1 = await token1.balanceOf(account.address)
                    let tokenContract = await getTokenContract(pairAddress)
                    await tokenContract.connect(account).approve(migrationRouter.address, ethers.constants.MaxUint256)
                    expect(await tokenContract.balanceOf(account.address)).to.equal(liquidityAmount)
                    expect(await toPairContract.balanceOf(account.address)).to.equal(0)
                    await migrationRouter.connect(account).migrateLiquidity(pairAddress, toPairAddress, account.address, liquidityAmount, getDeadline())
                    expect(await toPairContract.balanceOf(account.address)).to.gt(0)

                    // computes the real charge back and verify that they match exactly
                    let balance0 = await token0.balanceOf(account.address)
                    let balance1 = await token1.balanceOf(account.address)
                    let expectedChargeBack0 = balance0.gte(previousBalance0) ? balance0.sub(previousBalance0) : previousBalance0.sub(balance0)
                    let expectedChargeBack1 = balance1.gte(previousBalance1) ? balance1.sub(previousBalance1) : previousBalance1.sub(balance1)
                    expect(chargeBack0).to.equal(expectedChargeBack0)
                    expect(chargeBack1).to.equal(expectedChargeBack1)
                })
            }
        })

        describe("PNG", async function() {
            for(let tokenSymbol of Object.keys(fixture.Migrators)) {
                let tokenAddress = fixture.Tokens[tokenSymbol as TokenSymbol]
                if (!((tokenSymbol as AVAXPairsTokenSymbol) in fixture.Pairs.PNG)) continue
                if (fixture.TokensWithoutFund.includes(tokenSymbol)) continue
                it(`Can migrate liquidity from PNG-${tokenSymbol}`, async function() {
                    let pairAddress = fixture.Pairs.PNG[tokenSymbol as PNGPairsTokenSymbol]
                    let toPairAddress = fixture.Pairs.Migrated.PNG[tokenSymbol as PNGPairsTokenSymbol]
                    let migrator = fixture.Migrators[tokenSymbol as MigratorTokenSymbol]
                    await migrationRouter.connect(owner).addMigrator(tokenAddress, migrator)
                    let liquidityAmount = await fundLiquidityToken(account, pairAddress, BigNumber.from(10).pow(20))
                    let fromPairContract = await getTokenContract(pairAddress)
                    await fromPairContract.connect(account).approve(migrationRouter.address, ethers.constants.MaxUint256)
                    let migratedPair = await getPairContract(toPairAddress);
                    expect(await migratedPair.balanceOf(account.address)).to.equal(0)
                    await migrationRouter.connect(account).migrateLiquidity(pairAddress, toPairAddress, account.address, liquidityAmount, getDeadline())
                    expect(await migratedPair.balanceOf(account.address)).to.gt(0)
                    
                    //makes sure there's no dust left in the migration router
                    let token0 = await getTokenContract(await migratedPair.token0())
                    let token1 = await getTokenContract(await migratedPair.token1())
                    expect(await token0.balanceOf(migrationRouter.address)).to.equal(0)
                    expect(await token1.balanceOf(migrationRouter.address)).to.equal(0)
                    expect(await migratedPair.balanceOf(migrationRouter.address)).to.equal(0)
                    expect(await fromPairContract.balanceOf(migrationRouter.address)).to.equal(0)

                })
                it(`Can compute accurately chargeback from PNG-${tokenSymbol}`, async function() {
                    let pairAddress = fixture.Pairs.AVAX[tokenSymbol as AVAXPairsTokenSymbol]
                    let toPairAddress = fixture.Pairs.Migrated.AVAX[tokenSymbol as AVAXMigratedPairsTokenSymbol]
                    let migrator = fixture.Migrators[tokenSymbol as MigratorTokenSymbol]
                    await migrationRouter.connect(owner).addMigrator(tokenAddress, migrator)
                    let liquidityAmount = await fundLiquidityToken(account, pairAddress, BigNumber.from(10).pow(20))
                    let toPairContract = await getPairContract(toPairAddress)

                    // reads the chargeback
                    let [chargeBack0, chargeBack1] = await migrationRouter.calculateChargeBack(pairAddress, toPairAddress, liquidityAmount)
                    // reads the previous balance to compute the real charge back
                    let token0 = await getTokenContract(await toPairContract.token0())
                    let token1 = await getTokenContract(await toPairContract.token1())
                    let previousBalance0 = await token0.balanceOf(account.address)
                    let previousBalance1 = await token1.balanceOf(account.address)
                    let tokenContract = await getTokenContract(pairAddress)
                    await tokenContract.connect(account).approve(migrationRouter.address, ethers.constants.MaxUint256)
                    expect(await tokenContract.balanceOf(account.address)).to.equal(liquidityAmount)
                    expect(await toPairContract.balanceOf(account.address)).to.equal(0)
                    await migrationRouter.connect(account).migrateLiquidity(pairAddress, toPairAddress, account.address, liquidityAmount, getDeadline())
                    expect(await toPairContract.balanceOf(account.address)).to.gt(0)

                    // computes the real charge back and verify that they match exactly
                    let balance0 = await token0.balanceOf(account.address)
                    let balance1 = await token1.balanceOf(account.address)
                    let expectedChargeBack0 = balance0.gte(previousBalance0) ? balance0.sub(previousBalance0) : previousBalance0.sub(balance0)
                    let expectedChargeBack1 = balance1.gte(previousBalance1) ? balance1.sub(previousBalance1) : previousBalance1.sub(balance1)
                    expect(chargeBack0).to.equal(expectedChargeBack0)
                    expect(chargeBack1).to.equal(expectedChargeBack1)
                })
            }
        })
    })
})

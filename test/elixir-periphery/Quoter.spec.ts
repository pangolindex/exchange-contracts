import { Fixture } from "ethereum-waffle";
import { constants, Wallet } from "ethers";
import { ethers, waffle, network } from "hardhat";
import {
  MockTimeNonfungiblePositionManager,
  ElixirQuoter,
  TestERC20,
} from "../../typechain";
import completeFixture from "./shared/completeFixture";
import { FeeAmount, MaxUint128, TICK_SPACINGS } from "./shared/constants";
import { encodePriceSqrt } from "./shared/encodePriceSqrt";
import { expandTo18Decimals } from "./shared/expandTo18Decimals";
import { expect } from "./shared/expect";
import { encodePath } from "./shared/path";
import { createPool } from "./shared/quoter";

describe("Quoter", () => {
  let wallet: Wallet;
  let trader: Wallet;

  const swapRouterFixture: Fixture<{
    nft: MockTimeNonfungiblePositionManager;
    tokens: [TestERC20, TestERC20, TestERC20];
    quoter: ElixirQuoter;
  }> = async (wallets, provider) => {
    const { weth9, factory, router, tokens, nft } = await completeFixture(
      wallets,
      provider
    );

    ////// POOL IMPLEMENTATION DEPLOYMENT
    //  impersonating poolDeployer's account
    const poolDeployerAddress = "0x427207B1Cdb6F2Ab8B1D21Ab77600f00b0a639a7";
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [poolDeployerAddress],
    });

    const poolDeployer = await (ethers as any).getSigner(poolDeployerAddress);

    //  fund the impersonated account
    await wallets[0].sendTransaction({
      to: poolDeployerAddress,
      value: ethers.utils.parseEther("100"),
    });

    const poolFactory = await ethers.getContractFactory("ElixirPool");
    const poolImplementation = await poolFactory.connect(poolDeployer).deploy();
    //////

    // approve & fund wallets
    for (const token of tokens) {
      await token.approve(router.address, constants.MaxUint256);
      await token.approve(nft.address, constants.MaxUint256);
      await token.connect(trader).approve(router.address, constants.MaxUint256);
      await token.transfer(trader.address, expandTo18Decimals(1_000_000));
    }

    const quoterFactory = await ethers.getContractFactory("ElixirQuoter");
    quoter = (await quoterFactory.deploy(
      factory.address,
      weth9.address
    )) as ElixirQuoter;

    return {
      tokens,
      nft,
      quoter,
    };
  };

  let nft: MockTimeNonfungiblePositionManager;
  let tokens: [TestERC20, TestERC20, TestERC20];
  let quoter: ElixirQuoter;

  let loadFixture: ReturnType<typeof waffle.createFixtureLoader>;

  before("create fixture loader", async () => {
    const wallets = await (ethers as any).getSigners();
    [wallet, trader] = wallets;
    loadFixture = waffle.createFixtureLoader(wallets);
  });

  // helper for getting weth and token balances
  beforeEach("load fixture", async () => {
    ({ tokens, nft, quoter } = await loadFixture(swapRouterFixture));
  });

  describe("quotes", () => {
    beforeEach(async () => {
      await createPool(nft, wallet, tokens[0].address, tokens[1].address);
      await createPool(nft, wallet, tokens[1].address, tokens[2].address);
    });

    describe("#quoteExactInput", () => {
      it("0 -> 1", async () => {
        const quote = await quoter.callStatic.quoteExactInput(
          encodePath(
            [tokens[0].address, tokens[1].address],
            [FeeAmount.MEDIUM]
          ),
          3
        );

        expect(quote[0]).to.eq(1);
      });

      it("1 -> 0", async () => {
        const quote = await quoter.callStatic.quoteExactInput(
          encodePath(
            [tokens[1].address, tokens[0].address],
            [FeeAmount.MEDIUM]
          ),
          3
        );

        expect(quote[0]).to.eq(1);
      });

      it("0 -> 1 -> 2", async () => {
        const quote = await quoter.callStatic.quoteExactInput(
          encodePath(
            tokens.map((token) => token.address),
            [FeeAmount.MEDIUM, FeeAmount.MEDIUM]
          ),
          5
        );

        expect(quote[0]).to.eq(1);
      });

      it("2 -> 1 -> 0", async () => {
        const quote = await quoter.callStatic.quoteExactInput(
          encodePath(tokens.map((token) => token.address).reverse(), [
            FeeAmount.MEDIUM,
            FeeAmount.MEDIUM,
          ]),
          5
        );

        expect(quote[0]).to.eq(1);
      });
    });

    describe("#quoteExactInputSingle", () => {
      it("0 -> 1", async () => {
        const quote = await quoter.callStatic.quoteExactInputSingle(
          tokens[0].address,
          tokens[1].address,
          FeeAmount.MEDIUM,
          MaxUint128,
          // -2%
          encodePriceSqrt(100, 102)
        );

        expect(quote[0]).to.eq(9852);
      });

      it("1 -> 0", async () => {
        const quote = await quoter.callStatic.quoteExactInputSingle(
          tokens[1].address,
          tokens[0].address,
          FeeAmount.MEDIUM,
          MaxUint128,
          // +2%
          encodePriceSqrt(102, 100)
        );

        expect(quote[0]).to.eq(9852);
      });
    });

    describe("#quoteExactOutput", () => {
      it("0 -> 1", async () => {
        const quote = await quoter.callStatic.quoteExactOutput(
          encodePath(
            [tokens[1].address, tokens[0].address],
            [FeeAmount.MEDIUM]
          ),
          1
        );

        expect(quote[0]).to.eq(3);
      });

      it("1 -> 0", async () => {
        const quote = await quoter.callStatic.quoteExactOutput(
          encodePath(
            [tokens[0].address, tokens[1].address],
            [FeeAmount.MEDIUM]
          ),
          1
        );

        expect(quote[0]).to.eq(3);
      });

      it("0 -> 1 -> 2", async () => {
        const quote = await quoter.callStatic.quoteExactOutput(
          encodePath(tokens.map((token) => token.address).reverse(), [
            FeeAmount.MEDIUM,
            FeeAmount.MEDIUM,
          ]),
          1
        );

        expect(quote[0]).to.eq(5);
      });

      it("2 -> 1 -> 0", async () => {
        const quote = await quoter.callStatic.quoteExactOutput(
          encodePath(
            tokens.map((token) => token.address),
            [FeeAmount.MEDIUM, FeeAmount.MEDIUM]
          ),
          1
        );

        expect(quote[0]).to.eq(5);
      });
    });

    describe("#quoteExactOutputSingle", () => {
      it("0 -> 1", async () => {
        const quote = await quoter.callStatic.quoteExactOutputSingle(
          tokens[0].address,
          tokens[1].address,
          FeeAmount.MEDIUM,
          MaxUint128,
          encodePriceSqrt(100, 102)
        );

        expect(quote[0]).to.eq(9981);
      });

      it("1 -> 0", async () => {
        const quote = await quoter.callStatic.quoteExactOutputSingle(
          tokens[1].address,
          tokens[0].address,
          FeeAmount.MEDIUM,
          MaxUint128,
          encodePriceSqrt(102, 100)
        );

        expect(quote[0]).to.eq(9981);
      });
    });
  });
});

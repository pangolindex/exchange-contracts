import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { MockTimeElixirPool } from "../../../typechain/MockTimeElixirPool";
import { TestERC20 } from "../../../typechain/TestERC20";
import { ElixirFactory } from "../../../typechain/ElixirFactory";
import { TestElixirCallee } from "../../../typechain/TestElixirCallee";
import { TestElixirRouter } from "../../../typechain/TestElixirRouter";
import { MockTimeElixirPoolDeployer } from "../../../typechain/MockTimeElixirPoolDeployer";

import { Fixture } from "ethereum-waffle";

interface FactoryFixture {
  factory: ElixirFactory;
}

async function factoryFixture(): Promise<FactoryFixture> {
  const factoryFactory = await ethers.getContractFactory("ElixirFactory");
  const factory = (await factoryFactory.deploy()) as ElixirFactory;
  return { factory };
}

interface TokensFixture {
  token0: TestERC20;
  token1: TestERC20;
  token2: TestERC20;
}

async function tokensFixture(): Promise<TokensFixture> {
  const tokenFactory = await ethers.getContractFactory("TestERC20");
  const tokenA = (await tokenFactory.deploy(
    BigNumber.from(2).pow(255)
  )) as TestERC20;
  const tokenB = (await tokenFactory.deploy(
    BigNumber.from(2).pow(255)
  )) as TestERC20;
  const tokenC = (await tokenFactory.deploy(
    BigNumber.from(2).pow(255)
  )) as TestERC20;

  const [token0, token1, token2] = [tokenA, tokenB, tokenC].sort(
    (tokenA, tokenB) =>
      tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? -1 : 1
  );

  return { token0, token1, token2 };
}

type TokensAndFactoryFixture = FactoryFixture & TokensFixture;

interface PoolFixture extends TokensAndFactoryFixture {
  swapTargetCallee: TestElixirCallee;
  swapTargetRouter: TestElixirRouter;
  createPool(
    fee: number,
    tickSpacing: number,
    firstToken?: TestERC20,
    secondToken?: TestERC20
  ): Promise<MockTimeElixirPool>;
}

// Monday, October 5, 2020 9:00:00 AM GMT-05:00
export const TEST_POOL_START_TIME = 1601906400;

export const poolFixture: Fixture<PoolFixture> =
  async function (): Promise<PoolFixture> {
    const { factory } = await factoryFixture();
    const { token0, token1, token2 } = await tokensFixture();

    const MockTimeElixirPoolDeployerFactory = await ethers.getContractFactory(
      "MockTimeElixirPoolDeployer"
    );
    const MockTimeElixirPoolFactory = await ethers.getContractFactory(
      "MockTimeElixirPool"
    );

    const calleeContractFactory = await ethers.getContractFactory(
      "TestElixirCallee"
    );
    const routerContractFactory = await ethers.getContractFactory(
      "TestElixirRouter"
    );

    const swapTargetCallee =
      (await calleeContractFactory.deploy()) as TestElixirCallee;
    const swapTargetRouter =
      (await routerContractFactory.deploy()) as TestElixirRouter;

    return {
      token0,
      token1,
      token2,
      factory,
      swapTargetCallee,
      swapTargetRouter,
      createPool: async (
        fee,
        tickSpacing,
        firstToken = token0,
        secondToken = token1
      ) => {
        const mockTimePoolDeployer =
          (await MockTimeElixirPoolDeployerFactory.deploy()) as MockTimeElixirPoolDeployer;
        const tx = await mockTimePoolDeployer.deploy(
          factory.address,
          firstToken.address,
          secondToken.address,
          fee,
          tickSpacing
        );

        const receipt = await tx.wait();
        const poolAddress = receipt.events?.[0].args?.pool as string;
        return MockTimeElixirPoolFactory.attach(
          poolAddress
        ) as MockTimeElixirPool;
      },
    };
  };

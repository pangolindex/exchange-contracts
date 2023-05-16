import {
  abi as FACTORY_ABI,
  bytecode as FACTORY_BYTECODE,
} from "../../../artifacts/contracts/elixir-core/ElixirFactory.sol/ElixirFactory.json";
import {
  abi as FACTORY_V2_ABI,
  bytecode as FACTORY_V2_BYTECODE,
} from "../../../artifacts/contracts/pangolin-core/PangolinFactory.sol/PangolinFactory.json";
import { Fixture } from "ethereum-waffle";
import { ethers, waffle } from "hardhat";
import { IElixirFactory, IWETH9, MockTimeSwapRouter } from "../../typechain";

import WETH9 from "../contracts/WETH9.json";
import { Contract } from "@ethersproject/contracts";
import { constants } from "ethers";

const wethFixture: Fixture<{ weth9: IWETH9 }> = async ([wallet]) => {
  const weth9 = (await waffle.deployContract(wallet, {
    bytecode: WETH9.bytecode,
    abi: WETH9.abi,
  })) as IWETH9;

  return { weth9 };
};

export const v2FactoryFixture: Fixture<{ factory: Contract }> = async ([
  wallet,
]) => {
  const factory = await waffle.deployContract(
    wallet,
    {
      bytecode: FACTORY_V2_BYTECODE,
      abi: FACTORY_V2_ABI,
    },
    [constants.AddressZero]
  );

  return { factory };
};

const v3CoreFactoryFixture: Fixture<IElixirFactory> = async ([wallet]) => {
  const POOL_IMPLEMENTATION = "0x5cB5539A18591947C82f5D840B05ed79f6395491";

  return (await waffle.deployContract(
    wallet,
    {
      bytecode: FACTORY_BYTECODE,
      abi: FACTORY_ABI,
    },
    [POOL_IMPLEMENTATION]
  )) as IElixirFactory;
};

export const v3RouterFixture: Fixture<{
  weth9: IWETH9;
  factory: IElixirFactory;
  router: MockTimeSwapRouter;
}> = async ([wallet], provider) => {
  const { weth9 } = await wethFixture([wallet], provider);
  const factory = await v3CoreFactoryFixture([wallet], provider);

  const router = (await (
    await ethers.getContractFactory("MockTimeSwapRouter")
  ).deploy(factory.address, weth9.address)) as MockTimeSwapRouter;

  return { factory, weth9, router };
};

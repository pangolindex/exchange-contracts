import { bytecode } from "../../../artifacts/contracts/PangolinV3-core/ElixirPool.sol/ElixirPool.json";
import { utils } from "ethers";

// export const POOL_BYTECODE_HASH = utils.keccak256(bytecode);
export const POOL_BYTECODE_HASH =
  "0x41a723f9e6457830b1b7a44df4435fab88581d073226894b33131815dd674c22";

export function computePoolAddress(
  factoryAddress: string,
  [tokenA, tokenB]: [string, string],
  fee: number
): string {
  const [token0, token1] =
    tokenA.toLowerCase() < tokenB.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA];
  const constructorArgumentsEncoded = utils.defaultAbiCoder.encode(
    ["address", "address", "uint24"],
    [token0, token1, fee]
  );
  const create2Inputs = [
    "0xff",
    factoryAddress,
    // salt
    utils.keccak256(constructorArgumentsEncoded),
    // init code hash
    POOL_BYTECODE_HASH,
  ];
  const sanitizedInputs = `0x${create2Inputs.map((i) => i.slice(2)).join("")}`;
  return utils.getAddress(`0x${utils.keccak256(sanitizedInputs).slice(-40)}`);
}

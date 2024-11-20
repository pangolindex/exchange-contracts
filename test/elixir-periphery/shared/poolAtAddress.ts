import { abi as POOL_ABI } from "../../../artifacts/contracts/PangolinV3-core/ElixirPool.sol/ElixirPool.json";
import { Contract, Wallet } from "ethers";
import { IPangolinV3Pool } from "../../../typechain";

export default function poolAtAddress(
  address: string,
  wallet: Wallet
): IPangolinV3Pool {
  return new Contract(address, POOL_ABI, wallet) as IPangolinV3Pool;
}

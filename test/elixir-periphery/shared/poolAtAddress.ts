import { abi as POOL_ABI } from "../../../artifacts/contracts/elixir-core/ElixirPool.sol/ElixirPool.json";
import { Contract, Wallet } from "ethers";
import { IElixirPool } from "../../typechain";

export default function poolAtAddress(
  address: string,
  wallet: Wallet
): IElixirPool {
  return new Contract(address, POOL_ABI, wallet) as IElixirPool;
}

from brownie import DummyERC20, PangolinFeeCollector, accounts

STAKING_CONTRACT = "0x88afdaE1a9F58Da3E68584421937E5F564A0135b"
MULTISIG_OWNER = "0x7491158583ccb44a4678b3d1eccc1f41aed10a1f"


def main():
    deployer = accounts.load('avalanche-deploy')
    collector = PangolinFeeCollector.deploy("0x88afdaE1a9F58Da3E68584421937E5F564A0135b", 0, {"from": deployer})
    collector.transferOwnership(MULTISIG_OWNER, {"from": deployer})
    # send some tokens to the multisig for staking in MiniChef
    erc20 = DummyERC20.deploy("DummyLP", "PGL", MULTISIG_OWNER, 1e20, {'from': deployer})
    erc20.transferOwnership(MULTISIG_OWNER, {"from": deployer})
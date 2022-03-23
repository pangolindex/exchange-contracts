pragma solidity ^0.7.6;

import "openzeppelin-contracts-legacy/access/Ownable.sol";
import "openzeppelin-contracts-legacy/token/ERC20/SafeERC20.sol";
import "openzeppelin-contracts-legacy/token/ERC20/IERC20.sol";

/**
 * Custodian of community's PNG. Deploy this contract, then change the owner to be a
 * governance protocol. Send community treasury funds to the deployed contract, then
 * spend them through governance proposals.
 */
contract CommunityTreasury is Ownable {
    using SafeERC20 for IERC20;

    // Token to custody
    IERC20 public png;

    constructor(address png_) {
        png = IERC20(png_);
    }

    /**
     * Transfer PNG to the destination. Can only be called by the contract owner.
     */
    function transfer(address dest, uint amount) external onlyOwner {
        png.safeTransfer(dest, amount);
    }

    /**
     * Return the PNG balance of this contract.
     */
    function balance() view external returns(uint) {
        return png.balanceOf(address(this));
    }

}
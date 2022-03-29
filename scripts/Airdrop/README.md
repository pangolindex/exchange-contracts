# Airdrop Scripts

Once `yarn deploy` is ran, deployed contracts will be stored in
`addresses/` directory as a file with the network’s name. For example,
`yarn deploy --network avalanche_fuji` will create a file named
`addresses/avalanche_fuji.js`.

After the deployment, you can use airdrop scripts.

If it's only test it's better to be the only 1 multisig owner, or only have 1 required on the multisig. (it's necessary for Airdrop/Airdrop.js).

Airdrop/SetWhitelister.js, change the whitelister by you.

Airdrop/AddWhitelistAddresses.js, for this script you need to be the whitelister, it's add all addresses and amounts of csv network file, for example if you want whitelist on avalanche_fuji, it's will use `avalanche_fuji.csv`, to prepare your csv file you have `example.csv`.

After that's you need use Airdrop/AllowClaiming.js to allow the claim.

If you want to use  Airdrop/SetWhitelister.js then Airdrop/AddWhitelistAddresses.js then Airdrop/AllowClaiming.js, you can directly use Airdrop/Airdrop.js.

And for end the airdrop you can use Airdrop/EndAirdrop.js.

To get some info on the Airdrop contract you have Airdrop/AirdropInfo.js.

You must also add your private key to the `.env` file.

To execute a script use: `npx hardhat --network avalanche_fuji run yourScriptPath`

## Test on fuji

1. make sure you are single owner of multisig in constants  avalanche fuji.js
2. deploy contracts ``yarn deploy --network avalanche_fuji``
3. check airdrop info `npx hardhat --network avalanche_fuji run scripts/Airdrop/AirdropInfo.js`
4. fill list data in scripts/Airdrop/lists/avalanche_fuji.csv
4. set up airdrop `npx hardhat --network avalanche_fuji run scripts/Airdrop/Airdrop.js`
5. check new airdrop info `npx hardhat --network avalanche_fuji run scripts/Airdrop/AirdropInfo.js`
5. end airdrop `npx hardhat --network avalanche_fuji run scripts/Airdrop/EndAirdrop.js`
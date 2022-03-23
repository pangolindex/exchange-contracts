# Verify Contracts

Once `yarn deploy` is ran, deployed contracts will be stored in
`addresses/` directory as a file with the network’s name. For example,
`yarn deploy --network avalanche_fuji` will create a file named
`addresses/avalanche_fuji.js`. If `yarn deploy` is ran again for the
same network, it will overwrite the previous one. If you want to keep a
record of the contracts, consider copying the file to somewhere else.

After the deployment, you can run `yarn verify` to publish the source
codes of the contracts. Continuing the example above, you must run
`yarn verify --network avalanche_fuji`.

This tool verifies contracts only on Etherscan and its forks. Not
all networks has Etherscan, hence the tool supports only handful of
networks. For supported networks, refer to the
[plugin’s website](https://hardhat.org/plugins/nomiclabs-hardhat-etherscan.html)

You must also add your API keys to the `.env` file. You can also deduce
the available networks from the empty variable names in the `.env` file.

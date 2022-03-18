const { ethers, network } = require("hardhat");
const fs = require("fs");
const { CHAINS } = require("@pangolindex/sdk");

function writeSrcFile(fileName, data) {
    fs.writeFileSync(
        "subgraph/" + network.name + "/src/mappings/" + fileName,
        data
    );
}

function fetchChain() { 
    for (let i = 0; i < CHAINS.length; i++) {
        if (network.name === CHAINS[i].id) {
            return CHAINS[i];
        }   
    }
}

function replaceByArray(data, array) {
    let string = '';
    for (let i = 0; i < array.length; i++) {
        string += '\'' + array[i] + '\',';
        if (i != array.length - 1) {
            string += '\n\t';
        }
    }
    console.log(string);
    data = data.replace(/"0x0000000000000000000000000000000000000000",/g, string);
    return data
}

async function main() {
    let dir = __dirname + "/../subgraph/" + network.name;
    let chain = await fetchChain();
    let dataSubgraph = fs.readFileSync("subgraph/sample/subgraph.yaml", 'utf8');
    dataSubgraph = dataSubgraph.replace(/DEPLOY_NETWORK/g, chain.name);
    dataSubgraph = dataSubgraph.replace(/FACTORY_ADDRESS/g, chain.contracts.factory);
    dataSubgraph = dataSubgraph.replace(/START_BLOCK/g, '1');
    let dataSchema = fs.readFileSync("subgraph/sample/schema.graphql", 'utf8');
    let dataCore = fs.readFileSync("subgraph/sample/src/mappings/core.ts", 'utf8');
    dataCore = replaceByArray(dataCore, chain.theGraph.tokens_whitelist);
    let dataDayUpdates = fs.readFileSync("subgraph/sample/src/mappings/dayUpdates.ts", 'utf8');
    let dataFactory = fs.readFileSync("subgraph/sample/src/mappings/factory.ts", 'utf8');
    let dataHelpers = fs.readFileSync("subgraph/sample/src/mappings/helpers.ts", 'utf8');
    dataHelpers = dataHelpers.replace(/0x000000000000000000000000000000000factory/g, chain.contracts.factory);
    dataHelpers = dataHelpers.replace(/0x0000000000000000000000000000000000router/g, chain.contracts.router);
    let dataPricing = fs.readFileSync("subgraph/sample/src/mappings/pricing.ts", 'utf8');
    dataPricing = dataPricing.replace(/0x000000000000000000000000000000000000wavax/g, chain.contracts.wrapped_native_token);
    dataPricing = dataPricing.replace(/PRICE/g, chain.theGraph.native_price_pre_stable);
    dataPricing = replaceByArray(dataPricing, chain.theGraph.mining_pools);
    let dataPackage = fs.readFileSync("subgraph/sample/package.json", 'utf8');

    if(!fs.existsSync(dir)) {
        fs.mkdirSync(dir + "/src/mappings", {recursive: true});
    }
    fs.writeFileSync(
        "subgraph/" + network.name + "/subgraph.yaml",
        dataSubgraph
    );
    fs.writeFileSync(
        "subgraph/" + network.name + "/schema.graphql",
        dataSchema
    );
    fs.writeFileSync(
        "subgraph/" + network.name + "/package.json",
        dataPackage
    );
    writeSrcFile("core.ts", dataCore);
    writeSrcFile("dayUpdates.ts", dataDayUpdates);
    writeSrcFile("factory.ts", dataFactory);
    writeSrcFile("helpers.ts", dataHelpers);
    writeSrcFile("pricing.ts", dataPricing);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

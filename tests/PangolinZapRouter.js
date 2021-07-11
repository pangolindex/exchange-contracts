const { expect } = require("chai")
const { ethers } = require("hardhat")
const { MakeAccountGenerator } = require("./utils")
const fixture = require('./fixture.json')


describe("ZapRouter", function() {

    let accountGenerator;

    beforeEach(async () => {    
        accountGenerator = await MakeAccountGenerator()

    })


    it("First test boilerplate", async function() {
        
    })

});

const { ethers } = require("hardhat")

module.exports.MakeAccountGenerator = async () => {
    let accounts = await ethers.getSigners()
    function* nextAccount() {
        for (let account of accounts) {
            yield account
        }
    }
    let newNextAccountGen = nextAccount()
    return () => newNextAccountGen.next().value
}
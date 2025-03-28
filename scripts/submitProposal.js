const { ethers, network } = require('hardhat');
const { BigNumber } = require('ethers');

const DEV_ADDRESS = "0xc17634466ec32f66ebbffd0e927d492406377b5f"
const GOVERNOR_ADDRESS = "0xb0Ff2b1047d9E8d294c2eD798faE3fA817F43Ee1"
const COMMUNITY_TREASURY_ADDRESS = "0x650f5865541f6D68BdDFE977dB933C293EA72358"

const TWO_MILLION_PNG = BigNumber.from('2000000' + '0'.repeat(18));

async function main() {

    const [deployer] = await ethers.getSigners();

    const submitter = new ethers.Wallet(process.env.PROPOSALS_SUBMITTER, ethers.provider);

    console.log("Deploying contracts with the account:", deployer.address);

    const GovernorAlpha = await ethers.getContractFactory("GovernorAlpha");
    const governorAlpha = await GovernorAlpha.attach(GOVERNOR_ADDRESS);

    const CommunityTreasury = await ethers.getContractFactory("CommunityTreasury");
    const communityTreasury = await CommunityTreasury.attach(COMMUNITY_TREASURY_ADDRESS);

    // Governance proposal
    const targets = [
        communityTreasury.address, // transfer
    ];
    const values = [0];
    const sigs = [
        'transfer(address,uint256)'
    ];
    const callDatas = [
        ethers.utils.defaultAbiCoder.encode(['address', 'uint256'], [DEV_ADDRESS, TWO_MILLION_PNG])
    ];

    const description =
`# Strategic Funding Proposal for Sustained Growth, Liquidity Incentives, and CEX Expansion

## Summary:

This proposal seeks DAO approval for the allocation of PNG Tokens from the Pangolin Community Treasury to fuel critical strategic initiatives. These funds will ensure Pangolin’s operational continuity, deepen liquidity across Pangolin V3, and support PNG’s expansion onto new centralized exchanges (CEXs) through listings and market-making.

## Objectives:

1. Sustain essential operations and maintain development momentum.  
2. Boost liquidity in Pangolin V3 pools through structured incentive programs.  
3. Facilitate PNG listings on new CEXs to broaden user access.  
4. Establish market-making infrastructure to ensure healthy PNG markets across platforms.

## Strategic Use of Funds:

1. Operational Continuity  
- Cover core infrastructure, engineering, audits, and backend maintenance.  
- Support team compensation, security upkeep, and administrative needs.

2. Pangolin V3 Liquidity Incentives  
- Deploy targeted PNG rewards to attract and retain liquidity providers.  
- Ensure a deep and stable trading environment for end users.

3. Centralized Exchange Listings  
- Fund listing fees, liquidity support, and co-marketing activities for upcoming CEX integrations.  
- Expand PNG exposure to new markets and global users.

4. Market-Making Operations  
- Establish and fund dedicated market-making accounts.  
- Improve liquidity, reduce slippage, and strengthen price discovery across exchanges.

## Requested 6-Month Budget:

We are requesting 2,000,000 PNG to be utilized over the next 6 months across the strategic areas mentioned above. All expenditures will follow transparent processes.

## Conclusion:

This funding proposal is designed to support Pangolin’s long-term vision by ensuring operational stability, incentivizing on-chain liquidity, and expanding PNG’s reach via new CEX integrations. By approving this proposal, the DAO empowers Pangolin to continue leading innovation within the Avalanche ecosystem.

## Voting Process:
PNG token holders can cast their votes via the Pangolin official governance platform until 31.03.2025`;

    console.log(`Submitting proposal`);
    await governorAlpha.connect(submitter).propose(targets, values, sigs, callDatas, description);
    const proposalNumber = await governorAlpha.proposalCount();
    console.log(`Made proposal #${proposalNumber}`);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });

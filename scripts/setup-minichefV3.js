const { ethers, network } = require('hardhat');
const { BigNumber } = require('ethers');

const PNG_ADDRESS = "0x60781C2586D68229fde47564546784ab3fACA982";
const TREASURY_VESTER_ADDRESS = "0x6747AC215dAFfeE03a42F49FebB6ab448E12acEe";
const TREASURY_VESTER_PROXY_ADDRESS = "0x503C4e38c80B1D17e2c653E142770CeA060a8bB7";
const COMMUNITY_TREASURY_ADDRESS = "0x650f5865541f6D68BdDFE977dB933C293EA72358";
const TIMELOCK_ADDRESS = "0xEB5c91bE6Dbfd30cf616127C2EA823C64e4b1ff8";
const GOVERNOR_ADDRESS = "0xb0Ff2b1047d9E8d294c2eD798faE3fA817F43Ee1";
const PANGOLIN_MULTISIG = "0x66c048d27aFB5EE59E4C07101A483654246A4eda";



const TWO_MILLION_PNG = BigNumber.from('2000000' + '0'.repeat(18));

const poolConfig = [
    [3000, '0xd7538cABBf8605BdE1f4901B47B8D42c61DE0367'], // WAVAX-PNG
    [3000, '0xC33Ac18900b2f63DFb60B554B1F53Cd5b474d4cd'], // PNG-USDCe
    [2000, '0xc13E562d92F7527c4389Cd29C67DaBb0667863eA'], // USDTe-USDCe
    [2000, '0xD4CBC976E1a1A2bf6F4FeA86DEB3308d68638211'], // WAVAX-SPELL
    [2000, '0x2F151656065E1d1bE83BD5b6F5e7509b59e6512D'], // WAVAX-TIME
    [2000, '0x5764b8D8039C6E32f1e5d8DE8Da05DdF974EF5D3'], // WAVAX-WBTCe
    [2000, '0xbA09679Ab223C6bdaf44D45Ba2d7279959289AB0'], // WAVAX-DAIe
    [2000, '0xe28984e1EE8D431346D32BeC9Ec800Efb643eef4'], // WAVAX-USDTe
    [2000, '0x7c05d54fc5CB6e4Ad87c6f5db3b807C94bB89c52'], // WAVAX-WETHe
    [2000, '0xbd918Ed441767fe7924e99F6a0E0B568ac1970D9'], // WAVAX-USDCe
    // [1000, '0x5875c368Cddd5FB9Bf2f410666ca5aad236DAbD4'], // WAVAX-LINKe
    // [1000, '0x221Caccd55F16B5176e14C0e9DBaF9C6807c83c9'], // USDCe-DAIe
    // [1000, '0x6745d7F9289d7d75B5121876B1b9D8DA775c9a3E'], // WAVAX-KLO
    // [1000, '0x4555328746f1b6a9b03dE964C90eCd99d75bFFbc'], // WAVAX-WALBT
    // [1000, '0x134Ad631337E8Bf7E01bA641fB650070a2e0efa8'], // WAVAX-JOE
    // [1000, '0xd2F01cd87A43962fD93C21e07c1a420714Cc94C9'], // WAVAX-YAK
    // [1000, '0x8dEd946a4B891D81A8C662e07D49E4dAee7Ab7d3'], // WAVAX-APEIN
    // [1000, '0x4a2cB99e8d91f82Cf10Fb97D43745A1f23e47caA'], // WAVAX-ROCO
    // [1000, '0x42152bDD72dE8d6767FE3B4E17a221D6985E8B25'], // WAVAX-XAVA
    // [1000, '0xE530dC2095Ef5653205CF5ea79F8979a7028065c'], // WAVAX-QI
    // [1000, '0xf0252ffAF3D3c7b3283E0afF56B66Db7105c318C'], // WAVAX-FRAX
    // [1000, '0xe36AE366692AcBf696715b6bDDCe0938398Dd991'], // WAVAX-AMPL
    // [500, '0xa1C2c3B6b120cBd4Cec7D2371FFd4a931A134A32'], // WAVAX-SNOB
    // [500, '0x494Dd9f783dAF777D3fb4303da4de795953592d0'], // WAVAX-PEFI
    // [500, '0xE44Ef634A6Eca909eCb0c73cb371140DE85357F9'], // WAVAX-OOE
    // [500, '0xE9DfCABaCA5E45C0F3C151f97900511f3E73Fb47'], // WAVAX-TUSD
    // [500, '0xd05e435Ae8D33faE82E8A9E79b28aaFFb54c1751'], // WAVAX-HUSKY
    // [500, '0x4F20E367B10674cB45Eb7ede68c33B702E1Be655'], // WAVAX-TEDDY
    // [500, '0x497070e8b6C55fD283D8B259a6971261E2021C01'], // WAVAX-DYP
    // [500, '0x0a63179a8838b5729E79D239940d7e29e40A0116'], // WAVAX-SPORE
    // [500, '0x04D80d453033450703E3DC2d0C1e0C0281c42D81'], // WAVAX-YAY
    // [500, '0xd69De4d5FF6778b59Ff504d7d09327B73344Ff10'], // WAVAX-VEE
    // [500, '0x5085678755446F839B1B575cB3d1b6bA85C65760'], // WAVAX-WOW
    // [500, '0x0B1efd689eBA7E610955d0FaBd9Ab713a04c3895'], // WAVAX-HCT
    // [500, '0xA34862a7de51a0E1aEE6d3912c3767594390586d'], // WAVAX-IMX
    // [300, '0xEd764838FA66993892fa37D57d4036032B534f24'], // WAVAX-INSUR
    // [200, '0x662135c6745D45392bf011018f95Ad9913DcBf5c'], // WAVAX-ORBS
];


async function main() {

    const [deployer, user1] = await ethers.getSigners();

    const PNG = await ethers.getContractFactory("Png");
    const png = await PNG.attach(PNG_ADDRESS);

    // Large PNG holder (gnosis safe)
    const acc = '0x66c048d27aFB5EE59E4C07101A483654246A4eda';

    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [acc]
    });

    const gnosisSafe = await ethers.provider.getSigner(acc);

    await user1.sendTransaction({
        to: gnosisSafe._address,
        value: ethers.utils.parseEther('1000.0')
    });

    // Self delegate
    await png.connect(gnosisSafe).delegate(acc);

    console.log("Deploying contracts with the account:", deployer.address);

    const equalWeight = 100;

    // Deploy MiniChefV3
    const MiniChef = await ethers.getContractFactory("MiniChefV3");
    const miniChef = await MiniChef.deploy(
        png.address,
        poolConfig.length * equalWeight,
        deployer.address,
    );
    await miniChef.deployed();
    console.log("Deployed MiniChefV3:", miniChef.address);

    // Add funder
    console.log(`Adding funders`);
    await miniChef.addFunder(TREASURY_VESTER_PROXY_ADDRESS);
    console.log(`Done`);

    // Add Pools
    console.log(`Adding pools`);
    await miniChef.addPools(
      poolConfig.map(entry => entry[1]),
      poolConfig.map(entry => '0x0000000000000000000000000000000000000000'),
    );
    console.log(`Done`);

    // Set Weights
    console.log('Set allocation points');
    await miniChef.setAllocPoints(
      poolConfig.map((entry, pid) => pid),
      poolConfig.map(entry => equalWeight),
    );
    console.log(`Done`);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });

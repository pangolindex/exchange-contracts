# Pangolin Token

## Airdrop Instructions

Generate a CSV file with at least two columns. Its first four lines will be discarded, so the CSV must start from the fifth line. The fifth line must be a header. One of the columns should have a header titled `address`, and the othe other column should have a header titled `allocated amount`. They should list the airdrop recipient EVM address and the corresponding airdrop amount in its smallest denominator (e.g. wei). An address must not repeat. Below is the `head` of an example airdrop file.

```csv
Airdrop name,PNG holders 1,Airdrop id,77e7ce13-175c-59cc-9851-9e6f91d523b8
Days transfers,423
Days lp,423
Days stake,209
address,transfers,lp,stake,total amount,day average total amount,allocated amount
0x5f71a197D303Cd700511323976067ECe43dE8AD0,0,264869892466635833344,900000000000000000000,1164869892466635833344,5558560012793712922.481160994,42150403369008584983
0x392ba0702CB461B1ee1aFD39221A41D4d961dAa2,0,0,66643398903922311168,66643398903922311168,318867937339341201.7607655502,2417966550574648084
0xdd85DC6BE21cE76A2457315E93Ad23286A486988,0,0,172000000000000000000,172000000000000000000,822966507177033492.8229665072,6240531748664490208
0xB39ED41edD5BC794027fbbEc44B957B38390493F,305657173744426024960,152828586872213012480,0,458485760616639037440,1445187582715962292.955082742,10958816566728850096
0xef24ca62187Dc526c2Fbce9752F37605E725C996,76300576209990647808,0,0,76300576209990647808,180379612789575999.5460992908,1367813502260800454
```

After such an airdrop file is generated, it must be located in a directory called `airdrop` inside the git root, and it should be named `NETWORK_NAME-addresses.csv`, where `NETWORK_NAME` is the name of the network as stated in our sdk repo. The default network name is `hardhat`. In that case `/airdrop/hardhat-addresses.csv` must be used.

Then, `/airdrop/NETWORK_NAME` directory must be created. Then `npx hardhat run --network NETWORK_NAME scripts/generateMerkleTree.js` can be executed. The execution can take about an hour for hundred thousand addresses. This script will generate `/airdrop/NETWORK_NAME/USER_ADDRESS.json` files, which will contain the merkle proof and the airdrop amount. Below is an example of a proof file.

```js
{"address":"0x88f9ee8f5f71034d0bb1e3fc06d9b6ff155c3664","amount":"2344761580115667451904","proof":["0x88f99824574104666a600e7c556c494c3fcb7fb2000000036a2c13835f2ac000","0xc9f78075ab330b9d8343d1deb63d7ab77e080822ff9dad1746f31584fa239b74","0xa024409ab3543da0f2a1784d9d8630993f72c0347c1586dd956585ec0838d1f0","0x0354f9f5fb1743f88aa153f761bdfed95e1405c0146464a1c23a29a2d88574f7","0x6e35ed985a3e3e6730c8d41ef2e7281e4b6c1f6a9f8c9359a01d81f4ad313e09","0x7151a1589f5a47882c71a863e3513245c27b6e62fc765b5fcd13b425205d3313","0x6a2192721cc38407e9fb68c31bccf73fcf04f32d815579a5daf421d613e0a29f","0x70f32dd61433d32f444bc6415127a02310ae27432b501e5ddad901b42a767b77","0xd6ff7ee95eb46419ad3c2c2456c2ca492f020439f9acf6278c45b8aef036e7e8","0x5415662a220d2d223649558ee3361e5fb61d9b5fdc1265710fe408d6a955c547","0x76f42816162d283c9387b4f75e6414585e5386cd50213815d8c0cbc94f389b70","0xa7edb26c91b69acd197908ee6911996896a556db72bce9e42c4320f29b0f4ad1","0x3eb3ef74b6467f3188041dfd78328aa1553e76a21e9015ea4d6bd185d2b0798b","0x44927b6d1e18b48c801260f59efab9c108170c748d8a1d642850cafa9f2edeee","0xa70a3d3e4c0dc0088d8f1cda83e191f451ad7e7923fcaa37c4ec1243f42357af","0xc70937e243aca953915eb19540e5756142f3df2154b5e974ecb43ee4cf519070","0xbf2486eefd7e810d43c5d58260321bbdae49c170a586557b5db85eabcdae3a0f"],"root":"0x16799bbf5f8987c8e1d5680997a79bbffba7ac979acbe71de1b1ae70df0d9d5e"}
```

Finally, `/airdrop/NETWORK_NAME` directory can be copied to a server to be statically served.


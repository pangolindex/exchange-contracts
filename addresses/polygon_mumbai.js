exports.ADDRESSES=[
    {
      "address": "0x4828a3D98E428e73184374845f23C40eB76bA695", // PNG
      "args": [
        {
          "type": "BigNumber",
          "hex": "0xbe4064fbcc1d7ea6000000"
        },
        {
          "type": "BigNumber",
          "hex": "0x0983383fca34acbb800000"
        },
        "matPNG",
        "Pangolin"
      ]
    },
    {
      "address": "0x2412CF7162500001035B34a4aC4Cf4876B9a6f4b", // Chain Multisig
      "args": [
        [
          "0x72C397908Cb93d1B569BBB0Ff8d3D26B7b21d730",
          "0xDA315a838E918026E51A864c43766f5AE86be8c6"
        ],
        2,
        0
      ]
    },
    {
      "address": "0x9284868361460C0Ca3dfcDcf035e90F0ea3A72A0", // Foundation Multisig
      "args": [
        [
          "0x72c397908cb93d1b569bbb0ff8d3d26b7b21d730",
          "0x5e5b04a92890dee8921c2355220f09551fadb296",
          "0x0de046423099cfd8c2fe02c7e1155b018cdc9992",
          "0xecc562d8d3812d53d9ee4047920d47111a160b6a",
          "0x223a06744123ab188affe484ec39b2d078b1db4e",
          "0xfd7b8597cf8ee5317439b0b5c55a111f6eec449d",
          "0xf5f08ba7f46e2a86b5ef3bfd56c2097c9f4276d7",
          "0xac2ecd9e4208e97c335fdddbbf49ee219c0e7da6",
          "0xc8643b1aba4d6ebde90a74ea311dfe235129be31",
          "0xec9b9ec0ec4cb499bb7c246e38ab43e4a5e1f1ce"
        ],
        5,
        0
      ]
    },
    {
      "address": "0xE6ec3b8AD6ad20210a2698d89016DDF6965E5fBC", // Timelock
      "args": [
        "0x2412CF7162500001035B34a4aC4Cf4876B9a6f4b",
        259200
      ]
    },
    {
      "address": "0xf7b351C98B5585b7aDa089F3fFD0fED785fB6cff", // PangolinFactory
      "args": [
        "0x5F27686E1fD42513c3c940b29C75441e656357D9"
      ]
    },
    {
      "address": "0x680ad00c72B8d55436E2812Df0f5a9Df7675e054", // PangolinRouter
      "args": [
        "0xf7b351C98B5585b7aDa089F3fFD0fED785fB6cff",
        "0x9c3C9283D3e44854697Cd22D3Faa240Cfb032889"
      ]
    },
    {
      "address": "0xa34Ad412652267FB3b1261D7d4F351a678B01Bf8", // MiniChefV2
      "args": [
        "0x4828a3D98E428e73184374845f23C40eB76bA695",
        "0x5F27686E1fD42513c3c940b29C75441e656357D9"
      ]
    },
    {
      "address": "0x791d828FA611D5cD086e8047EAa8d7276c8d943E", // CommunityTreasury
      "args": [
        "0x4828a3D98E428e73184374845f23C40eB76bA695"
      ]
    },
    {
      "address": "0x3AA2baD17b768fFe5F9Fa05Ca95f97959862B41B", // StakingRewards
      "args": [
        "0x4828a3D98E428e73184374845f23C40eB76bA695",
        "0x4828a3D98E428e73184374845f23C40eB76bA695"
      ]
    },
    {
      "address": "0x34338ad5D7fd49B24D07D1D8e8d38Fc64F42f94A", // Airdrop
      "args": [
        {
          "type": "BigNumber",
          "hex": "0x0983383fca34acbb800000"
        },
        "0x4828a3D98E428e73184374845f23C40eB76bA695",
        "0x2412CF7162500001035B34a4aC4Cf4876B9a6f4b",
        "0x791d828FA611D5cD086e8047EAa8d7276c8d943E"
      ]
    },
    {
      "address": "0xFeC5354eF11981D5dAF92F6CA61e618c5AdF4FD5", // TreasuryVester
      "args": [
        "0x4828a3D98E428e73184374845f23C40eB76bA695",
        {
          "type": "BigNumber",
          "hex": "0xb4bd2cbc01e8d1ea800000"
        },
        [
          [
            "0x791d828FA611D5cD086e8047EAa8d7276c8d943E",
            2105,
            null
          ],
          [
            "0x2412CF7162500001035B34a4aC4Cf4876B9a6f4b",
            1579,
            null
          ],
          [
            "0x9284868361460C0Ca3dfcDcf035e90F0ea3A72A0",
            263,
            null
          ],
          [
            "0xa34Ad412652267FB3b1261D7d4F351a678B01Bf8",
            6053,
            true
          ]
        ],
        "0x2412CF7162500001035B34a4aC4Cf4876B9a6f4b"
      ]
    },
    {
      "address": "0x38F6d835FAF60a891016b2FC5692E76D2c6eEcbF", // Joint Multisig
      "args": [
        [
          "0x2412CF7162500001035B34a4aC4Cf4876B9a6f4b",
          "0x9284868361460C0Ca3dfcDcf035e90F0ea3A72A0"
        ],
        2,
        0
      ]
    },
    {
      "address": "0x780A51831dc1cE3AAD2879479dBE9419e834744c", // RevenueDistributor
      "args": [
        [
          [
            "0x9284868361460C0Ca3dfcDcf035e90F0ea3A72A0",
            2000
          ],
          [
            "0x2412CF7162500001035B34a4aC4Cf4876B9a6f4b",
            8000
          ]
        ]
      ]
    },
    {
      "address": "0xB2FcD54680150e3033A878cf1F689e1256d51fc5", // FeeCollector
      "args": [
        "0x9c3C9283D3e44854697Cd22D3Faa240Cfb032889",
        "0xf7b351C98B5585b7aDa089F3fFD0fED785fB6cff",
        "0x40231f6b438bce0797c9ada29b718a87ea0a5cea3fe9a771abdd76bd41a3e545",
        "0x3AA2baD17b768fFe5F9Fa05Ca95f97959862B41B",
        "0xa34Ad412652267FB3b1261D7d4F351a678B01Bf8",
        0,
        "0x780A51831dc1cE3AAD2879479dBE9419e834744c",
        "0xE6ec3b8AD6ad20210a2698d89016DDF6965E5fBC",
        "0x2412CF7162500001035B34a4aC4Cf4876B9a6f4b"
      ]
    },
    {
      "address": "0x794854430111cc72B6cE33AF0cF0a88C8d73BE5c", // DummyERC20
      "args": [
        "Dummy ERC20",
        "PGL",
        "0x5F27686E1fD42513c3c940b29C75441e656357D9",
        100
      ]
    }
  ]
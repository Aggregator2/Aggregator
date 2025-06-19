import { Token } from '../../types/token';

export const POPULAR_TOKENS: Record<number, Token[]> = {
  // Ethereum Mainnet
  1: [
    {
      symbol: 'USDT',
      name: 'Tether USD',
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      logoURI: 'https://coin-images.coingecko.com/coins/images/325/thumb/Tether.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 6,
      tags: ['stablecoin'],
      extensions: {
        coingeckoId: 'tether'
      }
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0xA0b86a33E6417a2f0A87c1A8aBE4e74B8D6fcb3b6',
      logoURI: 'https://coin-images.coingecko.com/coins/images/6319/thumb/USD_Coin_icon.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 6,
      tags: ['stablecoin']
    },
    {
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      logoURI: 'https://coin-images.coingecko.com/coins/images/9956/thumb/4943.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['stablecoin', 'defi']
    },
    {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      logoURI: 'https://coin-images.coingecko.com/coins/images/2518/thumb/weth.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['wrapped']
    },
    {
      symbol: 'LINK',
      name: 'ChainLink Token',
      address: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
      logoURI: 'https://coin-images.coingecko.com/coins/images/877/thumb/chainlink-new-logo.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['oracle', 'defi']
    },
    {
      symbol: 'UNI',
      name: 'Uniswap',
      address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
      logoURI: 'https://coin-images.coingecko.com/coins/images/12504/thumb/uniswap-uni.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['dex', 'defi', 'governance']
    },
    {
      symbol: 'AAVE',
      name: 'Aave Token',
      address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
      logoURI: 'https://coin-images.coingecko.com/coins/images/12645/thumb/AAVE.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['lending', 'defi', 'governance']
    },
    {
      symbol: 'MATIC',
      name: 'Polygon',
      address: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0',
      logoURI: 'https://coin-images.coingecko.com/coins/images/4713/thumb/matic-token-icon.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['layer2', 'scaling']
    },
    {
      symbol: 'SHIB',
      name: 'Shiba Inu',
      address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
      logoURI: 'https://coin-images.coingecko.com/coins/images/11939/thumb/shiba.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['meme']
    },
    {
      symbol: 'CRV',
      name: 'Curve DAO Token',
      address: '0xD533a949740bb3306d119CC777fa900bA034cd52',
      logoURI: 'https://coin-images.coingecko.com/coins/images/12124/thumb/Curve.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['defi', 'dex', 'dao']
    },
    {
      symbol: 'MKR',
      name: 'Maker',
      address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2',
      logoURI: 'https://coin-images.coingecko.com/coins/images/1364/thumb/Mark_Maker.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['defi', 'governance', 'stablecoin']
    },
    {
      symbol: 'SNX',
      name: 'Synthetix Network Token',
      address: '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F',
      logoURI: 'https://coin-images.coingecko.com/coins/images/3406/thumb/SNX.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['defi', 'derivatives']
    },
    {
      symbol: 'COMP',
      name: 'Compound',
      address: '0xc00e94Cb662C3520282E6f5717214004A7f26888',
      logoURI: 'https://coin-images.coingecko.com/coins/images/10775/thumb/COMP.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['defi', 'lending', 'governance']
    },
    {
      symbol: 'YFI',
      name: 'yearn.finance',
      address: '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e',
      logoURI: 'https://coin-images.coingecko.com/coins/images/11849/thumb/yfi-192x192.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['defi', 'yield']
    },
    {
      symbol: 'SUSHI',
      name: 'SushiToken',
      address: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2',
      logoURI: 'https://coin-images.coingecko.com/coins/images/12271/thumb/512x512_Logo_no_chop.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['defi', 'dex', 'amm']
    },
    {
      symbol: '1INCH',
      name: '1inch',
      address: '0x111111111117dC0aa78b770fA6A738034120C302',
      logoURI: 'https://coin-images.coingecko.com/coins/images/13469/thumb/1inch-token.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['defi', 'dex-aggregator']
    },
    {
      symbol: 'BAL',
      name: 'Balancer',
      address: '0xba100000625a3754423978a60c9317c58a424e3D',
      logoURI: 'https://coin-images.coingecko.com/coins/images/11683/thumb/Balancer.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['defi', 'dex', 'amm']
    },
    {
      symbol: 'FTM',
      name: 'Fantom Token',
      address: '0x4E15361FD6b4BB609Fa63C81A2be19d873717870',
      logoURI: 'https://coin-images.coingecko.com/coins/images/4001/thumb/Fantom.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['layer1']
    },
    {
      symbol: 'GRT',
      name: 'The Graph',
      address: '0xc944E90C64B2c07662A292be6244BDf05Cda44a7',
      logoURI: 'https://coin-images.coingecko.com/coins/images/13397/thumb/Graph_Token.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['web3', 'indexing']
    },
    {
      symbol: 'ENS',
      name: 'Ethereum Name Service',
      address: '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72',
      logoURI: 'https://coin-images.coingecko.com/coins/images/19785/thumb/acatxTm8_400x400.jpg',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['web3', 'identity']
    },
    {
      symbol: 'SAND',
      name: 'The Sandbox',
      address: '0x3845badAde8e6dFF049820680d1F14bD3903a5d0',
      logoURI: 'https://coin-images.coingecko.com/coins/images/12129/thumb/sandbox_logo.jpg',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['gaming', 'metaverse', 'nft']
    },
    {
      symbol: 'MANA',
      name: 'Decentraland',
      address: '0x0F5D2fB29fb7d3CFeE444a200298f468908cC942',
      logoURI: 'https://coin-images.coingecko.com/coins/images/878/thumb/decentraland-mana.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['gaming', 'metaverse', 'nft']
    },
    {
      symbol: 'AXS',
      name: 'Axie Infinity Shard',
      address: '0xBB0E17EF65F82Ab018d8EDd776e8DD940327B28b',
      logoURI: 'https://coin-images.coingecko.com/coins/images/13029/thumb/axie_infinity_logo.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['gaming', 'nft']
    },
    {
      symbol: 'APE',
      name: 'ApeCoin',
      address: '0x4d224452801ACEd8B2F0aebE155379bb5D594381',
      logoURI: 'https://coin-images.coingecko.com/coins/images/24383/small/apecoin.jpg',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['governance', 'nft']
    },
    {
      symbol: 'LDO',
      name: 'Lido DAO',
      address: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32',
      logoURI: 'https://coin-images.coingecko.com/coins/images/13573/thumb/Lido_DAO.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['liquid-staking', 'defi', 'dao']
    },
    {
      symbol: 'stETH',
      name: 'Lido Staked ETH',
      address: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
      logoURI: 'https://coin-images.coingecko.com/coins/images/13442/thumb/steth_logo.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['liquid-staking', 'defi']
    },
    {
      symbol: 'RPL',
      name: 'Rocket Pool',
      address: '0xD33526068D116cE69F19A9ee46F0bd304F21A51f',
      logoURI: 'https://coin-images.coingecko.com/coins/images/2090/thumb/rocket_pool.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['liquid-staking', 'defi']
    },
    {
      symbol: 'FRAX',
      name: 'Frax',
      address: '0x853d955aCEf822Db058eb8505911ED77F175b99e',
      logoURI: 'https://coin-images.coingecko.com/coins/images/13422/thumb/frax_logo.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['stablecoin', 'algorithmic']
    },
    {
      symbol: 'FXS',
      name: 'Frax Share',
      address: '0x3432B6A60D23Ca0dFCa7761B7ab56459D9C964D0',
      logoURI: 'https://coin-images.coingecko.com/coins/images/13423/thumb/frax_share.png',
      chainId: 1,
      type: 'ERC-20',
      decimals: 18,
      tags: ['algorithmic', 'governance']
    }
  ],

  // BSC (Binance Smart Chain)
  56: [
    {
      symbol: 'BUSD',
      name: 'Binance USD',
      address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
      logoURI: 'https://coin-images.coingecko.com/coins/images/9576/thumb/BUSD.png',
      chainId: 56,
      type: 'BEP-20',
      decimals: 18,
      tags: ['stablecoin']
    },
    {
      symbol: 'CAKE',
      name: 'PancakeSwap Token',
      address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
      logoURI: 'https://coin-images.coingecko.com/coins/images/12632/thumb/pancakeswap-cake-logo.png',
      chainId: 56,
      type: 'BEP-20',
      decimals: 18,
      tags: ['dex', 'defi', 'governance']
    },
    {
      symbol: 'BAKE',
      name: 'BakeryToken',
      address: '0xE02dF9e3e622DeBdD69fb838fB5a6081c03C1623',
      logoURI: 'https://coin-images.coingecko.com/coins/images/12526/thumb/bakerytoken.jpg',
      chainId: 56,
      type: 'BEP-20',
      decimals: 18,
      tags: ['defi']
    },
    {
      symbol: 'XVS',
      name: 'Venus',
      address: '0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63',
      logoURI: 'https://coin-images.coingecko.com/coins/images/12677/thumb/venus.png',
      chainId: 56,
      type: 'BEP-20',
      decimals: 18,
      tags: ['lending', 'defi']
    },
    {
      symbol: 'SAFEMOON',
      name: 'SafeMoon',
      address: '0x8076C74C5e3F5852037F31Ff0093Eeb8c8ADd8D3',
      logoURI: 'https://coin-images.coingecko.com/coins/images/14362/thumb/174x174-white.png',
      chainId: 56,
      type: 'BEP-20',
      decimals: 9,
      tags: ['meme']
    }
  ],

  // Polygon
  137: [
    {
      symbol: 'MATIC',
      name: 'Polygon',
      address: '0x0000000000000000000000000000000000001010',
      logoURI: 'https://coin-images.coingecko.com/coins/images/4713/thumb/matic-token-icon.png',
      chainId: 137,
      type: 'NATIVE',
      decimals: 18,
      tags: ['native']
    },
    {
      symbol: 'QUICK',
      name: 'QuickSwap',
      address: '0x831753DD7087CaC61aB5644b308642cc1c33Dc13',
      logoURI: 'https://coin-images.coingecko.com/coins/images/13970/thumb/1_pOp_DdspCCpJ_VkKMbKYzw.png',
      chainId: 137,
      type: 'ERC-20',
      decimals: 18,
      tags: ['dex', 'defi']
    },
    {
      symbol: 'SAND',
      name: 'The Sandbox',
      address: '0xBbba073C31bF03b8ACf7c28EF0738DeCF3695683',
      logoURI: 'https://coin-images.coingecko.com/coins/images/12129/thumb/sandbox_logo.jpg',
      chainId: 137,
      type: 'ERC-20',
      decimals: 18,
      tags: ['gaming', 'metaverse']
    },
    {
      symbol: 'GHST',
      name: 'Aavegotchi',
      address: '0x385Eeac5cB85A38A9a07A70c73e0a3271CfB54A7',
      logoURI: 'https://coin-images.coingecko.com/coins/images/12467/thumb/ghst_200.png',
      chainId: 137,
      type: 'ERC-20',
      decimals: 18,
      tags: ['gaming', 'nft']
    }
  ],

  // TRON
  1001: [
    {
      symbol: 'USDT',
      name: 'Tether USD (TRC-20)',
      address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      logoURI: 'https://coin-images.coingecko.com/coins/images/325/thumb/Tether.png',
      chainId: 1001,
      type: 'TRC-20',
      decimals: 6,
      tags: ['stablecoin']
    },
    {
      symbol: 'WIN',
      name: 'WINk',
      address: 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7',
      logoURI: 'https://coin-images.coingecko.com/coins/images/8224/thumb/wink.png',
      chainId: 1001,
      type: 'TRC-20',
      decimals: 6,
      tags: ['gaming']
    },
    {
      symbol: 'BTT',
      name: 'BitTorrent',
      address: 'TAFjULxiVgT4qWk6UZwjqwZXTSaGaqnVp4',
      logoURI: 'https://coin-images.coingecko.com/coins/images/7595/thumb/BTT.png',
      chainId: 1001,
      type: 'TRC-20',
      decimals: 18,
      tags: ['file-sharing']
    }
  ],

  // Solana
  101: [
    {
      symbol: 'SOL',
      name: 'Solana',
      address: 'So11111111111111111111111111111111111111112',
      logoURI: 'https://coin-images.coingecko.com/coins/images/4128/thumb/solana.png',
      chainId: 101,
      type: 'NATIVE',
      decimals: 9,
      tags: ['native']
    },
    {
      symbol: 'USDC',
      name: 'USD Coin (SPL)',
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      logoURI: 'https://coin-images.coingecko.com/coins/images/6319/thumb/USD_Coin_icon.png',
      chainId: 101,
      type: 'SPL',
      decimals: 6,
      tags: ['stablecoin']
    },
    {
      symbol: 'SRM',
      name: 'Serum',
      address: 'SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt',
      logoURI: 'https://coin-images.coingecko.com/coins/images/11970/thumb/serum-logo.png',
      chainId: 101,
      type: 'SPL',
      decimals: 6,
      tags: ['dex', 'defi']
    },
    {
      symbol: 'RAY',
      name: 'Raydium',
      address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
      logoURI: 'https://coin-images.coingecko.com/coins/images/13928/thumb/PSigc4a.png',
      chainId: 101,
      type: 'SPL',
      decimals: 6,
      tags: ['dex', 'defi']
    },
    {
      symbol: 'FTT',
      name: 'FTX Token',
      address: 'AGFEad2et2ZJif9jaGpdMixQqvW5i81aBdvKe7PHNfz3',
      logoURI: 'https://coin-images.coingecko.com/coins/images/9026/thumb/F.png',
      chainId: 101,
      type: 'SPL',
      decimals: 6,
      tags: ['exchange']
    }
  ],

  // Avalanche
  43114: [
    {
      symbol: 'AVAX',
      name: 'Avalanche',
      address: '0x0000000000000000000000000000000000000000',
      logoURI: 'https://coin-images.coingecko.com/coins/images/12559/thumb/coin-round-red.png',
      chainId: 43114,
      type: 'NATIVE',
      decimals: 18,
      tags: ['native']
    },
    {
      symbol: 'PNG',
      name: 'Pangolin',
      address: '0x60781C2586D68229fde47564546784ab3fACA982',
      logoURI: 'https://coin-images.coingecko.com/coins/images/13442/thumb/pangolin.PNG',
      chainId: 43114,
      type: 'ERC-20',
      decimals: 18,
      tags: ['dex', 'defi']
    },
    {
      symbol: 'JOE',
      name: 'JoeToken',
      address: '0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd',
      logoURI: 'https://coin-images.coingecko.com/coins/images/17569/thumb/traderjoe.png',
      chainId: 43114,
      type: 'ERC-20',
      decimals: 18,
      tags: ['dex', 'defi']
    }
  ],

  // Cosmos Hub
  118: [
    {
      symbol: 'ATOM',
      name: 'Cosmos',
      address: 'uatom',
      logoURI: 'https://coin-images.coingecko.com/coins/images/1481/thumb/cosmos_hub.png',
      chainId: 118,
      type: 'IBC',
      decimals: 6,
      tags: ['native', 'staking']
    },
    {
      symbol: 'OSMO',
      name: 'Osmosis',
      address: 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2',
      logoURI: 'https://coin-images.coingecko.com/coins/images/16724/thumb/osmo.png',
      chainId: 118,
      type: 'IBC',
      decimals: 6,
      tags: ['dex', 'defi']
    },
    {
      symbol: 'AKT',
      name: 'Akash Network',
      address: 'ibc/1480B8FD20AD5FCAE81EA87584D269547DD4D436843C1D20F15E00EB64743EF4',
      logoURI: 'https://coin-images.coingecko.com/coins/images/12785/thumb/akash-logo.png',
      chainId: 118,
      type: 'IBC',
      decimals: 6,
      tags: ['cloud']
    },
    {
      symbol: 'JUNO',
      name: 'Juno',
      address: 'ibc/C4CFF46FD6DE35CA4CF4CE031E643C8FDC9BA4B99AE598E9B0ED98FE3A2319F9',
      logoURI: 'https://coin-images.coingecko.com/coins/images/19249/thumb/juno.png',
      chainId: 118,
      type: 'IBC',
      decimals: 6,
      tags: ['smart-contracts']
    },
    {
      symbol: 'SCRT',
      name: 'Secret',
      address: 'ibc/0954E1C28EB7AF5B72D24F3BC2B47BBB2FDF91BDDFD57B74B99E133AED40972A',
      logoURI: 'https://coin-images.coingecko.com/coins/images/11871/thumb/Secret.png',
      chainId: 118,
      type: 'IBC',
      decimals: 6,
      tags: ['privacy']
    }
  ],

  // Algorand
  301: [
    {
      symbol: 'ALGO',
      name: 'Algorand',
      address: '0',
      logoURI: 'https://coin-images.coingecko.com/coins/images/4380/thumb/download.png',
      chainId: 301,
      type: 'NATIVE',
      decimals: 6,
      tags: ['native']
    },
    {
      symbol: 'USDT',
      name: 'Tether USDt (ASA)',
      address: '312769',
      logoURI: 'https://coin-images.coingecko.com/coins/images/325/thumb/Tether.png',
      chainId: 301,
      type: 'ASA',
      decimals: 6,
      tags: ['stablecoin']
    },
    {
      symbol: 'USDC',
      name: 'USD Coin (ASA)',
      address: '31566704',
      logoURI: 'https://coin-images.coingecko.com/coins/images/6319/thumb/USD_Coin_icon.png',
      chainId: 301,
      type: 'ASA',
      decimals: 6,
      tags: ['stablecoin']
    },
    {
      symbol: 'PLANET',
      name: 'PlanetWatch',
      address: '27165954',
      logoURI: 'https://coin-images.coingecko.com/coins/images/17734/thumb/planet.PNG',
      chainId: 301,
      type: 'ASA',
      decimals: 6,
      tags: ['iot']
    }
  ],

  // Stellar
  0: [
    {
      symbol: 'XLM',
      name: 'Stellar Lumens',
      address: 'native',
      logoURI: 'https://coin-images.coingecko.com/coins/images/100/thumb/Stellar_symbol_black_RGB.png',
      chainId: 0,
      type: 'NATIVE',
      decimals: 7,
      tags: ['native']
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      address: 'USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      logoURI: 'https://coin-images.coingecko.com/coins/images/6319/thumb/USD_Coin_icon.png',
      chainId: 0,
      type: 'other',
      decimals: 7,
      tags: ['stablecoin']
    },
    {
      symbol: 'USDT',
      name: 'Tether USD',
      address: 'USDT-GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V',
      logoURI: 'https://coin-images.coingecko.com/coins/images/325/thumb/Tether.png',
      chainId: 0,
      type: 'other',
      decimals: 7,
      tags: ['stablecoin']
    }
  ],

  // Cardano
  2024: [
    {
      symbol: 'ADA',
      name: 'Cardano',
      address: 'lovelace',
      logoURI: 'https://coin-images.coingecko.com/coins/images/975/thumb/cardano.png',
      chainId: 2024,
      type: 'NATIVE',
      decimals: 6,
      tags: ['native']
    },
    {
      symbol: 'MELD',
      name: 'MELD',
      address: '6ac8ef33b510ec004fe11585f7c5a9f0c07f0c23428ab4f29c1d7d104d454c44',
      logoURI: 'https://coin-images.coingecko.com/coins/images/19525/thumb/meld_logo.png',
      chainId: 2024,
      type: 'other',
      decimals: 6,
      tags: ['defi']
    },
    {
      symbol: 'AGIX',
      name: 'SingularityNET',
      address: 'f43a62fdc3965df486de8a0d32fe800963589c41b38946602a0dc535424041494158',
      logoURI: 'https://coin-images.coingecko.com/coins/images/2138/thumb/singularitynet.png',
      chainId: 2024,
      type: 'other',
      decimals: 8,
      tags: ['ai']
    },
    {
      symbol: 'WMT',
      name: 'World Mobile Token',
      address: '1d7f33bd23d85e1a25d87d86fac4f199c3197a2f7afeb662a0f34e1e776f726c646d6f62696c65746f6b656e',
      logoURI: 'https://coin-images.coingecko.com/coins/images/17904/thumb/wmt.png',
      chainId: 2024,
      type: 'other',
      decimals: 6,
      tags: ['telecom']
    }
  ],

  // Tezos
  1729: [
    {
      symbol: 'XTZ',
      name: 'Tezos',
      address: 'tez',
      logoURI: 'https://coin-images.coingecko.com/coins/images/976/thumb/Tezos-logo.png',
      chainId: 1729,
      type: 'NATIVE',
      decimals: 6,
      tags: ['native']
    },
    {
      symbol: 'tzBTC',
      name: 'tzBTC',
      address: 'KT1PWx2mnDueood7fEmfbBDKx1D9BAnnXitn',
      logoURI: 'https://coin-images.coingecko.com/coins/images/11576/thumb/tzBTC.png',
      chainId: 1729,
      type: 'FA1.2',
      decimals: 8,
      tags: ['wrapped']
    },
    {
      symbol: 'USDtz',
      name: 'USDtez',
      address: 'KT1LN4LPSqTMS7Sd2CJw4bbDGRkMv2t68Fy9',
      logoURI: 'https://coin-images.coingecko.com/coins/images/13212/thumb/usdtz.png',
      chainId: 1729,
      type: 'FA1.2',
      decimals: 6,
      tags: ['stablecoin']
    }
  ]
};

// Utility function to get popular tokens for a specific chain
export function getPopularTokensForChain(chainId: number): Token[] {
  return POPULAR_TOKENS[chainId] || [];
}

// Utility function to get all popular tokens across all chains
export function getAllPopularTokens(): Token[] {
  return Object.values(POPULAR_TOKENS).flat();
}

// Utility function to search popular tokens by symbol
export function searchPopularTokens(symbol: string): Token[] {
  const lowerSymbol = symbol.toLowerCase();
  return getAllPopularTokens().filter(token => 
    token.symbol.toLowerCase().includes(lowerSymbol) ||
    token.name.toLowerCase().includes(lowerSymbol)
  );
}
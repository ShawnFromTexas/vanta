import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

// -------------------------------
// REAL RPCs
// -------------------------------
const RPC = {
  ethereum: [
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth",
    "https://ethereum.publicnode.com",
  ],
  base: [
    "https://base.llamarpc.com",
    "https://mainnet.base.org",
  ],
  arbitrum: [
    "https://arbitrum.llamarpc.com",
    "https://arb1.arbitrum.io/rpc",
  ],
  polygon: [
    "https://polygon.llamarpc.com",
    "https://polygon-rpc.com",
  ],
  optimism: [
    "https://optimism.llamarpc.com",
    "https://mainnet.optimism.io",
  ],
};

// -------------------------------
// CHAINLINK PRICE FEEDS (native)
// -------------------------------
const CHAINLINK_FEEDS = {
  ethereum: {
    native: "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419",
  },
  base: {
    native: "0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8",
  },
  arbitrum: {
    native: "0x639fe6ab55c921f74e7fac1ee960c0b6293ba612",
  },
  polygon: {
    native: "0xab594600376ec9fd91f8e885dadf0ce036862de0",
  },
  optimism: {
    native: "0x13e3ee699d1909e989722e753853ae30b17e08c5",
  },
};

// -------------------------------
// TOKEN LIST
// -------------------------------
const TOKENS = {
  ethereum: [
    {
      address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      symbol: "USDC",
      decimals: 6,
      coingeckoId: "usd-coin",
    },
    {
      address: "0xdac17f958d2ee523a2206206994597c13d831ec7",
      symbol: "USDT",
      decimals: 6,
      coingeckoId: "tether",
    },
    {
      address: "0x6b175474e89094c44da98b954eedeac495271d0f",
      symbol: "DAI",
      decimals: 18,
      coingeckoId: "dai",
    },
    {
      address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      symbol: "WETH",
      decimals: 18,
      coingeckoId: "weth",
    },
  ],
  base: [
    {
      address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      symbol: "USDC",
      decimals: 6,
      coingeckoId: "usd-coin",
    },
  ],
  arbitrum: [
    {
      address: "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8",
      symbol: "USDC.e",
      decimals: 6,
      coingeckoId: "usd-coin",
    },
  ],
  polygon: [
    {
      address: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
      symbol: "USDC",
      decimals: 6,
      coingeckoId: "usd-coin",
    },
  ],
  optimism: [
    {
      address: "0x7f5c764cbc14f9669b88837ca1490cca17c31607",
      symbol: "USDC.e",
      decimals: 6,
      coingeckoId: "usd-coin",
    },
  ],
};

// -------------------------------
// COMMON SPENDERS
// -------------------------------
const SPENDERS = {
  ethereum: [
    {
      address: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      label: "Uniswap V3 Router",
    },
    {
      address: "0x1111111254EEB25477B68fb85Ed929f73A960582",
      label: "1inch Router",
    },
  ],
  base: [],
  arbitrum: [],
  polygon: [],
  optimism: [],
};

// Minimal ERC20 ABI
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

// -------------------------------
// HELPERS
// -------------------------------
async function getProvider(chain) {
  const urls = RPC[chain];
  if (!urls) throw new Error("Unsupported chain");

  const attempts = urls.map(
    (url) =>
      new Promise((resolve, reject) => {
        const provider = new ethers.JsonRpcProvider(url);
        provider
          .getBlockNumber()
          .then(() => resolve(provider))
          .catch(reject);
      })
  );

  return Promise.any(attempts);
}

async function getNativePrice(chain) {
  try {
    const provider = await getProvider(chain);
    const feedAddress = CHAINLINK_FEEDS[chain]?.native;
    if (!feedAddress) return null;

    const abi = [
      "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
    ];

    const priceFeed = new ethers.Contract(feedAddress, abi, provider);
    const roundData = await priceFeed.latestRoundData();
    return Number(roundData[1]) / 1e8;
  } catch {
    return null;
  }
}

async function getTokenPrices(tokens) {
  const ids = [...new Set(tokens.map((t) => t.coingeckoId).filter(Boolean))];
  if (ids.length === 0) return {};

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(
    ","
  )}&vs_currencies=usd`;

  try {
    const res = await fetch(url);
    return await res.json();
  } catch {
    return {};
  }
}

function inferProtocolsFromTx(tx) {
  const to = (tx.to || "").toLowerCase();
  const tags = [];

  if (!to) return tags;

  if (to.includes("uniswap") || to.includes("swap")) tags.push("DEX");
  if (to.includes("aave") || to.includes("compound")) tags.push("Lending");
  if (to.includes("bridge")) tags.push("Bridge");
  if (to.includes("nft")) tags.push("NFT");
  if (tags.length === 0) tags.push("Unknown / Direct");

  return tags;
}

function computeWalletHealthScore(summary) {
  let score = 80;

  if (summary.totalUsdValue < 50) score -= 5;
  if (summary.totalUsdValue > 10000) score += 5;

  if (summary.txCount < 5) score -= 10;
  if (summary.txCount > 100) score += 5;

  if (summary.riskFlags.includes("High gas usage")) score -= 5;
  if (summary.riskFlags.includes("Interacts with unknown contracts")) score -= 10;

  return Math.max(0, Math.min(100, score));
}

function generateAISummary(summary) {
  const parts = [];

  parts.push(
    `This wallet has approximately $${summary.totalUsdValue.toFixed(
      2
    )} in on-chain value on ${summary.chain}.`
  );

  if (summary.txCount < 5) {
    parts.push("It appears relatively new with limited transaction history.");
  } else if (summary.txCount > 100) {
    parts.push("It has a rich transaction history and appears to be an active user.");
  } else {
    parts.push("It has a moderate transaction history.");
  }

  if (summary.riskFlags.length > 0) {
    parts.push(`Key risk considerations: ${summary.riskFlags.join(", ")}.`);
  } else {
    parts.push("No major risk signals were detected.");
  }

  return parts.join(" ");
}

async function getContractIntel(provider, address) {
  try {
    const code = await provider.getCode(address);
    const isContract = code && code !== "0x";

    if (!isContract) {
      return {
        isContract: false,
        codeSize: 0,
        deployTx: null,
        ageBlocks: null,
        txCount: null,
      };
    }

    const txCount = await provider.getTransactionCount(address);

    return {
      isContract: true,
      codeSize: (code.length - 2) / 2,
      deployTx: null,
      ageBlocks: null,
      txCount,
    };
  } catch {
    return {
      isContract: null,
      codeSize: null,
      deployTx: null,
      ageBlocks: null,
      txCount: null,
    };
  }
}

async function getWalletActivity(provider, chain, address) {
  try {
    const tokenList = TOKENS[chain] || [];
    if (tokenList.length === 0) return [];

    const latestBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 5000);

    const iface = new ethers.Interface(ERC20_ABI);
    const transferTopic = iface.getEvent("Transfer").topicHash;

    const events = [];

    for (const token of tokenList) {
      const filter = {
        address: token.address,
        fromBlock,
        toBlock: latestBlock,
        topics: [transferTopic, null, null],
      };

      const logs = await provider.getLogs(filter);
      for (const log of logs) {
        try {
          const parsed = iface.parseLog(log);
          const from = parsed.args.from.toLowerCase();
          const to = parsed.args.to.toLowerCase();
          const target = address.toLowerCase();
          if (from !== target && to !== target) continue;

          const amount =
            Number(parsed.args.value) / 10 ** token.decimals;

          events.push({
            type: "token_transfer",
            token: token.symbol,
            contract: token.address,
            from: parsed.args.from,
            to: parsed.args.to,
            amount,
            direction: to === target ? "in" : "out",
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
          });
        } catch {}
      }
    }

    events.sort((a, b) => b.blockNumber - a.blockNumber);
    return events.slice(0, 25);
  } catch {
    return [];
  }
}

// -------------------------------
// ROUTES
// -------------------------------
app.get("/", (req, res) => {
  res.json({ status: "VANTA backend is running" });
});

app.post("/diagnose", async (req, res) => {
  try {
    const { txHash, chain } = req.body;

    if (!txHash || !chain) {
      return res.status(400).json({ error: "Missing txHash or chain" });
    }

    const provider = await getProvider(chain);
    const tx = await provider.getTransaction(txHash);
    const receipt = await provider.getTransactionReceipt(txHash);

    if (!tx) {
      return res.json({ error: "Transaction not found" });
    }

    const priceNative = await getNativePrice(chain);
    const valueEth = Number(tx.value) / 1e18;
    const valueUsd = priceNative ? valueEth * priceNative : null;

    const protocols = inferProtocolsFromTx(tx);

    const tokenList = TOKENS[chain] || [];
    const prices = await getTokenPrices(tokenList);
    const iface = new ethers.Interface(ERC20_ABI);
    const transferTopic = iface.getEvent("Transfer").topicHash;

    const tokenTransfers = [];

    if (receipt?.logs) {
      for (const log of receipt.logs) {
        const tokenMeta = tokenList.find(
          (t) => t.address.toLowerCase() === log.address.toLowerCase()
        );
        if (!tokenMeta) continue;
        if (!log.topics || log.topics[0] !== transferTopic) continue;

        try {
          const parsed = iface.parseLog(log);
          const amount =
            Number(parsed.args.value) / 10 ** tokenMeta.decimals;
          const priceData = prices[tokenMeta.coingeckoId];
          const usd =
            priceData?.usd ? amount * priceData.usd : null;

          tokenTransfers.push({
            token: tokenMeta.symbol,
            contract: tokenMeta.address,
            from: parsed.args.from,
            to: parsed.args.to,
            amount,
            amountUsd: usd,
          });
        } catch {}
      }
    }

    const toIntel = tx.to ? await getContractIntel(provider, tx.to) : null;

    res.json({
      chain,
      txHash,
      from: tx.from,
      to: tx.to,
      gasUsed: receipt?.gasUsed?.toString(),
      status: receipt?.status === 1 ? "success" : "failed",
      valueEth,
      valueUsd,
      blockNumber: tx.blockNumber,
      timestamp: Date.now(),
      protocols,
      tokenTransfers,
      contractIntel: toIntel,
    });
  } catch (err) {
    console.error("DIAGNOSE ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/wallet-summary", async (req, res) => {
  try {
    const { address, chain } = req.body;

    if (!address || !chain) {
      return res.status(400).json({ error: "Missing address or chain" });
    }

    const provider = await getProvider(chain);

    const balance = await provider.getBalance(address);
    const priceNative = await getNativePrice(chain);
    const valueEth = Number(balance) / 1e18;
    const nativeUsd = priceNative ? valueEth * priceNative : 0;

    const tokenList = TOKENS[chain] || [];
    const prices = await getTokenPrices(tokenList);

    const portfolio = [];
    let tokensUsdTotal = 0;

    for (const token of tokenList) {
      try {
        const contract = new ethers.Contract(
          token.address,
          ERC20_ABI,
          provider
        );
        const bal = await contract.balanceOf(address);
        const amount = Number(bal) / 10 ** token.decimals;
        if (amount <= 0) continue;

        const priceData = prices[token.coingeckoId];
        const usd =
          priceData?.usd ? amount * priceData.usd : 0;

        tokensUsdTotal += usd;

        portfolio.push({
          symbol: token.symbol,
          address: token.address,
          amount,
          amountUsd: usd,
        });
      } catch {}
    }

    const totalUsdValue = nativeUsd + tokensUsdTotal;
    const txCount = await provider.getTransactionCount(address);

    const riskFlags = [];
    if (txCount < 3) riskFlags.push("Low activity / new wallet");
    if (totalUsdValue > 10000) riskFlags.push("High value wallet");
    if (totalUsdValue < 10) riskFlags.push("Low value wallet");
    if (txCount > 50) riskFlags.push("High activity wallet");
    riskFlags.push("Interacts with unknown contracts");

    const activity = await getWalletActivity(provider, chain, address);

    const summary = {
      chain,
      address,
      balanceEth: valueEth,
      nativeUsd,
      totalUsdValue,
      txCount,
      riskFlags,
      portfolio,
      activity,
    };

    const healthScore = computeWalletHealthScore(summary);
    const aiSummary = generateAISummary(summary);

    res.json({
      ...summary,
      healthScore,
      aiSummary,
    });
  } catch (err) {
    console.error("WALLET SUMMARY ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/approvals", async (req, res) => {
  try {
    const { address, chain } = req.body;

    if (!address || !chain) {
      return res.status(400).json({ error: "Missing address or chain" });
    }

    const provider = await getProvider(chain);
    const tokenList = TOKENS[chain] || [];
    const spenderList = SPENDERS[chain] || [];

    const approvals = [];

    for (const token of tokenList) {
      const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
      for (const spender of spenderList) {
        try {
          const allowance = await contract.allowance(address, spender.address);
          const amount = Number(allowance) / 10 ** token.decimals;
          if (amount <= 0) continue;

          approvals.push({
            token: token.symbol,
            tokenAddress: token.address,
            spender: spender.address,
            spenderLabel: spender.label,
            amount,
            unlimited: amount > 1_000_000_000,
            risk:
              amount > 100000
                ? "high"
                : amount > 1000
                ? "medium"
                : "low",
          });
        } catch {}
      }
    }

    res.json({
      address,
      chain,
      approvals,
    });
  } catch (err) {
    console.error("APPROVALS ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// -------------------------------
// START SERVER
// -------------------------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`VANTA backend running on port ${PORT}`);
});

import { useState } from "react";
import Confetti from "react-confetti";

export default function Home() {
  const [txHash, setTxHash] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [chain, setChain] = useState("ethereum");
  const [loading, setLoading] = useState(false);
  const [txResult, setTxResult] = useState(null);
  const [walletSummary, setWalletSummary] = useState(null);
  const [approvals, setApprovals] = useState(null);
  const [error, setError] = useState("");
  const [showConfetti, setShowConfetti] = useState(false);

  const CHAINS = [
    { id: "ethereum", label: "Ethereum", color: "border-emerald-400 text-emerald-300" },
    { id: "base", label: "Base", color: "border-blue-400 text-blue-300" },
    { id: "arbitrum", label: "Arbitrum", color: "border-cyan-400 text-cyan-300" },
    { id: "polygon", label: "Polygon", color: "border-fuchsia-400 text-fuchsia-300" },
    { id: "optimism", label: "Optimism", color: "border-red-400 text-red-300" },
  ];

  const canAnalyze = txHash.trim() !== "" || walletAddress.trim() !== "";

  const analyzeEverything = async () => {
    if (!canAnalyze) return;

    setLoading(true);
    setError("");
    setTxResult(null);
    setWalletSummary(null);
    setApprovals(null);
    setShowConfetti(false);

    try {
      const promises = [];

      if (txHash.trim()) {
        promises.push(
          fetch("http://localhost:4000/diagnose", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txHash, chain }),
          }).then((r) => r.json())
        );
      } else {
        promises.push(Promise.resolve(null));
      }

      if (walletAddress.trim()) {
        promises.push(
          fetch("http://localhost:4000/wallet-summary", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: walletAddress, chain }),
          }).then((r) => r.json())
        );
        promises.push(
          fetch("http://localhost:4000/approvals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: walletAddress, chain }),
          }).then((r) => r.json())
        );
      } else {
        promises.push(Promise.resolve(null));
        promises.push(Promise.resolve(null));
      }

      const [txData, walletData, approvalsData] = await Promise.all(promises);

      if (txData && txData.error) {
        setError(txData.error);
      } else if (txData) {
        setTxResult(txData);
      }

      if (walletData && walletData.error) {
        setError(walletData.error);
      } else if (walletData) {
        setWalletSummary(walletData);
      }

      if (approvalsData && !approvalsData.error) {
        setApprovals(approvalsData);
      }

      if ((txData && !txData.error) || (walletData && !walletData.error)) {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 4000);
      }
    } catch (e) {
      setError("Backend unreachable");
    } finally {
      setLoading(false);
    }
  };

  // --- Derived intelligence helpers ---

  const classifyTransaction = (tx) => {
    if (!tx) return "Unknown";
    if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
      if (tx.valueEth > 0) return "Swap (native + tokens)";
      return "Token transfer / swap";
    }
    if (tx.valueEth > 0 && tx.to) return "Native transfer";
    if (tx.contractIntel?.isContract) return "Contract interaction";
    return "Unknown";
  };

  const getGasEfficiencyScore = (tx) => {
    if (!tx || !tx.gasUsed) return null;
    const gas = Number(tx.gasUsed);
    if (!gas) return null;
    if (gas < 80000) return { score: 85, label: "Efficient" };
    if (gas < 200000) return { score: 70, label: "Normal" };
    return { score: 55, label: "Heavy" };
  };

  const getWalletPersonality = (summary) => {
    if (!summary) return null;
    const { totalUsdValue, portfolio, txCount } = summary;

    const hasStable =
      portfolio && portfolio.some((t) => t.symbol.toUpperCase().includes("USDC") || t.symbol.toUpperCase().includes("USDT") || t.symbol.toUpperCase().includes("DAI"));
    const hasManyTokens = portfolio && portfolio.length >= 5;
    const isWhale = totalUsdValue > 100000;
    const isNew = txCount < 10;

    if (isWhale) return { label: "Whale", color: "bg-amber-500/20 text-amber-300 border-amber-400" };
    if (hasManyTokens && !hasStable) return { label: "DeFi Degen", color: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-400" };
    if (hasStable && totalUsdValue > 5000) return { label: "Stablecoin Maxi", color: "bg-emerald-500/20 text-emerald-300 border-emerald-400" };
    if (isNew) return { label: "New Wallet", color: "bg-blue-500/20 text-blue-300 border-blue-400" };
    return { label: "Balanced User", color: "bg-cyan-500/20 text-cyan-300 border-cyan-400" };
  };

  const getWhaleBadge = (summary) => {
    if (!summary) return null;
    if (summary.totalUsdValue > 250000) {
      return "Mega Whale";
    }
    if (summary.totalUsdValue > 50000) {
      return "Whale";
    }
    return null;
  };

  const buildSmartNotes = (summary, tx) => {
    const notes = [];
    if (!summary && !tx) return notes;

    if (summary) {
      if (summary.totalUsdValue > 10000) {
        notes.push("This wallet holds a meaningful on-chain balance; consider monitoring for large moves.");
      }
      if (summary.portfolio && summary.portfolio.length > 0) {
        const stables = summary.portfolio.filter((t) =>
          ["USDC", "USDT", "DAI"].includes(t.symbol.toUpperCase())
        );
        if (stables.length > 0) {
          notes.push("A significant portion of this wallet is in stablecoins, suggesting a defensive or parked capital posture.");
        }
        const longTail = summary.portfolio.filter(
          (t) => !["USDC", "USDT", "DAI"].includes(t.symbol.toUpperCase())
        );
        if (longTail.length >= 3) {
          notes.push("This wallet is exposed to multiple non-stable tokens, indicating higher volatility and risk.");
        }
      }
      if (summary.txCount < 5) {
        notes.push("Low transaction count suggests this wallet is either new or rarely used.");
      } else if (summary.txCount > 100) {
        notes.push("High transaction count suggests an active user or automated activity.");
      }
    }

    if (tx) {
      const classification = classifyTransaction(tx);
      notes.push(`The latest analyzed transaction is classified as: ${classification}.`);
      if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
        notes.push("This transaction involves ERC-20 token transfers, which may represent swaps, bridges, or protocol interactions.");
      }
      if (tx.valueUsd && tx.valueUsd > 5000) {
        notes.push("This transaction moved a relatively large USD value; consider tracking this wallet for future activity.");
      }
      if (tx.contractIntel?.isContract) {
        notes.push("The destination is a smart contract; review contract risk before interacting heavily.");
      }
    }

    return notes;
  };

  const buildRiskBreakdown = (summary, approvalsData) => {
    if (!summary) return null;
    const breakdown = [];

    const { riskFlags, totalUsdValue, txCount } = summary;

    breakdown.push({
      label: "Value Risk",
      score: totalUsdValue > 10000 ? 70 : totalUsdValue < 50 ? 40 : 55,
      notes:
        totalUsdValue > 10000
          ? "High value wallet; attractive target for exploits."
          : totalUsdValue < 50
          ? "Low value wallet; limited financial risk."
          : "Moderate value wallet.",
    });

    breakdown.push({
      label: "Activity Risk",
      score: txCount > 200 ? 65 : txCount < 5 ? 45 : 55,
      notes:
        txCount > 200
          ? "High activity; may be a power user, bot, or farm account."
          : txCount < 5
          ? "Low activity; limited behavioral data."
          : "Moderate activity; some behavioral data available.",
    });

    const unknownContracts = riskFlags?.includes("Interacts with unknown contracts");
    breakdown.push({
      label: "Contract Risk",
      score: unknownContracts ? 45 : 60,
      notes: unknownContracts
        ? "Wallet interacts with unknown or unclassified contracts; potential smart contract risk."
        : "No explicit unknown contract interactions detected from current heuristics.",
    });

    const approvals = approvalsData?.approvals || [];
    const hasHighApproval = approvals.some((a) => a.risk === "high" || a.unlimited);
    breakdown.push({
      label: "Approval Risk",
      score: hasHighApproval ? 40 : approvals.length > 0 ? 55 : 65,
      notes: approvals.length === 0
        ? "No tracked token approvals detected for curated protocols."
        : hasHighApproval
        ? "One or more large or unlimited approvals detected; consider revoking if unused."
        : "Approvals detected but not flagged as high risk based on current heuristics.",
    });

    return breakdown;
  };

  const buildProtocolExposure = (summary) => {
    if (!summary) return [];
    const exposure = [];
    if (!summary.portfolio) return exposure;

    const stables = summary.portfolio.filter((t) =>
      ["USDC", "USDT", "DAI"].includes(t.symbol.toUpperCase())
    );
    if (stables.length > 0) {
      const usd = stables.reduce((acc, t) => acc + t.amountUsd, 0);
      exposure.push({
        label: "Stablecoins",
        usd,
        note: "Exposure to stablecoins; lower volatility but smart contract and depeg risk.",
      });
    }

    const others = summary.portfolio.filter(
      (t) => !["USDC", "USDT", "DAI"].includes(t.symbol.toUpperCase())
    );
    if (others.length > 0) {
      const usd = others.reduce((acc, t) => acc + t.amountUsd, 0);
      exposure.push({
        label: "Volatile Tokens",
        usd,
        note: "Exposure to non-stable tokens; higher upside and downside risk.",
      });
    }

    return exposure;
  };

  const buildAllocation = (summary) => {
    if (!summary) return [];
    const parts = [];
    const total = summary.totalUsdValue || 0;
    if (total <= 0) return parts;

    if (summary.nativeUsd > 0) {
      parts.push({
        label: "Native",
        usd: summary.nativeUsd,
        pct: (summary.nativeUsd / total) * 100,
        color: "bg-purple-500",
      });
    }

    if (summary.portfolio && summary.portfolio.length > 0) {
      const stablesUsd = summary.portfolio
        .filter((t) =>
          ["USDC", "USDT", "DAI"].includes(t.symbol.toUpperCase())
        )
        .reduce((acc, t) => acc + t.amountUsd, 0);
      const othersUsd = summary.portfolio
        .filter(
          (t) => !["USDC", "USDT", "DAI"].includes(t.symbol.toUpperCase())
        )
        .reduce((acc, t) => acc + t.amountUsd, 0);

      if (stablesUsd > 0) {
        parts.push({
          label: "Stablecoins",
          usd: stablesUsd,
          pct: (stablesUsd / total) * 100,
          color: "bg-emerald-500",
        });
      }
      if (othersUsd > 0) {
        parts.push({
          label: "Other Tokens",
          usd: othersUsd,
          pct: (othersUsd / total) * 100,
          color: "bg-cyan-500",
        });
      }
    }

    return parts;
  };

  const personality = getWalletPersonality(walletSummary);
  const whaleBadge = getWhaleBadge(walletSummary);
  const smartNotes = buildSmartNotes(walletSummary, txResult);
  const riskBreakdown = buildRiskBreakdown(walletSummary, approvals);
  const protocolExposure = buildProtocolExposure(walletSummary);
  const allocation = buildAllocation(walletSummary);
  const gasEfficiency = getGasEfficiencyScore(txResult);
  const txClassification = classifyTransaction(txResult);

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      {/* Glow + Grid Background */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(80,0,255,0.18),transparent_60%)] pointer-events-none" />
      <div className="absolute inset-0 opacity-40 bg-[linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:30px_30px] animate-pulse" />

      {/* Floating scan line */}
      <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-purple-500 to-transparent animate-[scan_3s_linear_infinite]" />

      {showConfetti && <Confetti numberOfPieces={800} gravity={0.2} />}

      <div className="relative z-10 max-w-5xl mx-auto pt-16 pb-16 px-6">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-6xl font-extrabold mb-3 tracking-tight bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 text-transparent bg-clip-text mx-auto animate-pulse drop-shadow-[0_0_20px_rgba(128,0,255,0.4)]">
            VANTA
          </h1>
          <p className="text-neutral-400 text-sm max-w-xl mx-auto">
            Paste a wallet, a transaction, or both. VANTA will analyze everything in one shot and surface real intelligence.
          </p>
        </div>

        {/* Chain Pills */}
        <div className="flex flex-wrap justify-center gap-2 mb-6">
          {CHAINS.map((c) => (
            <button
              key={c.id}
              onClick={() => setChain(c.id)}
              className={`px-3 py-1 rounded-full border text-xs transition ${
                chain === c.id
                  ? `${c.color} bg-white/10`
                  : "border-neutral-700 text-neutral-400 hover:border-neutral-500"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Inputs + Button */}
        <div className="bg-neutral-900/70 border border-purple-600/30 rounded-2xl p-6 backdrop-blur-xl shadow-[0_0_30px_rgba(128,0,255,0.35)] transition hover:scale-[1.02] mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-neutral-400 mb-1">
                Wallet Address (optional)
              </label>
              <input
                className="w-full px-4 py-3 rounded-xl bg-neutral-950 border border-neutral-800 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                placeholder="0x..."
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400 mb-1">
                Transaction Hash (optional)
              </label>
              <input
                className="w-full px-4 py-3 rounded-xl bg-neutral-950 border border-neutral-800 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                placeholder="0x..."
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
              />
            </div>
          </div>

          <button
            onClick={analyzeEverything}
            disabled={loading || !canAnalyze}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-blue-500 hover:from-purple-500 hover:to-blue-400 disabled:from-neutral-700 disabled:to-neutral-700 text-sm font-medium transition shadow-[0_0_18px_rgba(128,0,255,0.5)] animate-[pulse_2s_infinite]"
          >
            {loading ? "Analyzing..." : "Analyze Everything"}
          </button>
        </div>

        {/* Unified Results Card */}
        {(txResult || walletSummary) && (
          <div className="bg-neutral-900/80 border border-purple-600/30 rounded-2xl p-6 backdrop-blur-xl shadow-[0_0_30px_rgba(128,0,255,0.35)] animate-[glow_2s_ease-in-out] space-y-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-sm font-semibold text-neutral-200">
                Analysis Results
              </h2>
              {walletSummary && (
                <div className="flex items-center gap-2">
                  {personality && (
                    <span
                      className={`px-2 py-1 rounded-full border text-[10px] uppercase tracking-wide ${personality.color}`}
                    >
                      {personality.label}
                    </span>
                  )}
                  {whaleBadge && (
                    <span className="px-2 py-1 rounded-full border border-amber-400 bg-amber-500/10 text-[10px] uppercase tracking-wide text-amber-300">
                      {whaleBadge}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
              {/* Left: Transaction */}
              {txResult && (
                <div>
                  <div className="mb-2 text-neutral-400 font-semibold flex items-center justify-between">
                    <span>Transaction</span>
                    <span className="text-[10px] text-neutral-500">
                      {txClassification}
                    </span>
                  </div>
                  <div className="space-y-2 bg-neutral-950/80 border border-neutral-800 rounded-xl p-4">
                    <div>
                      <span className="text-neutral-400">Chain:</span>{" "}
                      <span className="font-mono">{txResult.chain}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-neutral-400">Status:</span>{" "}
                        <span
                          className={
                            txResult.status === "success"
                              ? "text-emerald-400 font-medium"
                              : "text-red-400 font-medium"
                          }
                        >
                          {txResult.status}
                        </span>
                      </div>
                      {gasEfficiency && (
                        <div className="text-[10px] text-neutral-400">
                          Gas:{" "}
                          <span className="font-mono">
                            {gasEfficiency.score}/100
                          </span>{" "}
                          <span className="text-neutral-300">
                            ({gasEfficiency.label})
                          </span>
                        </div>
                      )}
                    </div>
                    <div>
                      <span className="text-neutral-400">From:</span>{" "}
                      <span className="font-mono break-all">{txResult.from}</span>
                    </div>
                    <div>
                      <span className="text-neutral-400">To:</span>{" "}
                      <span className="font-mono break-all">{txResult.to}</span>
                    </div>
                    <div>
                      <span className="text-neutral-400">Gas Used:</span>{" "}
                      <span className="font-mono">{txResult.gasUsed}</span>
                    </div>
                    <div>
                      <span className="text-neutral-400">Value (native):</span>{" "}
                      <span className="font-mono">{txResult.valueEth}</span>
                    </div>
                    <div>
                      <span className="text-neutral-400">Value (USD):</span>{" "}
                      <span className="font-mono">
                        {txResult.valueUsd != null
                          ? `$${Number(txResult.valueUsd).toFixed(2)}`
                          : "N/A"}
                      </span>
                    </div>

                    {txResult.contractIntel && (
                      <div className="mt-3 border border-neutral-800 rounded-lg p-2">
                        <div className="text-neutral-400 mb-1">
                          Contract Intelligence
                        </div>
                        <div className="text-[11px] text-neutral-300 space-y-1">
                          <div>
                            <span className="text-neutral-400">Is Contract:</span>{" "}
                            <span className="font-mono">
                              {txResult.contractIntel.isContract === null
                                ? "Unknown"
                                : txResult.contractIntel.isContract
                                ? "Yes"
                                : "No"}
                            </span>
                          </div>
                          <div>
                            <span className="text-neutral-400">Code Size (bytes):</span>{" "}
                            <span className="font-mono">
                              {txResult.contractIntel.codeSize ?? "N/A"}
                            </span>
                          </div>
                          <div>
                            <span className="text-neutral-400">Tx Count:</span>{" "}
                            <span className="font-mono">
                              {txResult.contractIntel.txCount ?? "N/A"}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {txResult.tokenTransfers && txResult.tokenTransfers.length > 0 && (
                      <div className="mt-3">
                        <div className="text-neutral-400 mb-1">
                          Token Transfers:
                        </div>
                        <div className="space-y-1">
                          {txResult.tokenTransfers.map((t, idx) => (
                            <div key={idx} className="border border-neutral-800 rounded-lg p-2">
                              <div>
                                <span className="text-neutral-400">Token:</span>{" "}
                                <span className="font-mono">{t.token}</span>
                              </div>
                              <div>
                                <span className="text-neutral-400">Amount:</span>{" "}
                                <span className="font-mono">{t.amount}</span>
                              </div>
                              <div>
                                <span className="text-neutral-400">Value (USD):</span>{" "}
                                <span className="font-mono">
                                  {t.amountUsd != null
                                    ? `$${t.amountUsd.toFixed(2)}`
                                    : "N/A"}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Right: Wallet */}
              {walletSummary && (
                <div className="space-y-4">
                  <div>
                    <div className="mb-2 text-neutral-400 font-semibold">
                      Wallet
                    </div>
                    <div className="space-y-3 bg-neutral-950/80 border border-neutral-800 rounded-xl p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-400">Health Score</span>
                        <span className="font-mono text-lg text-emerald-400">
                          {walletSummary.healthScore}/100
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-400">Native Balance:</span>{" "}
                        <span className="font-mono">
                          {walletSummary.balanceEth.toFixed(4)}
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-400">Native Value (USD):</span>{" "}
                        <span className="font-mono">
                          ${walletSummary.nativeUsd.toFixed(2)}
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-400">Total Value (USD):</span>{" "}
                        <span className="font-mono">
                          ${walletSummary.totalUsdValue.toFixed(2)}
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-400">Tx Count:</span>{" "}
                        <span className="font-mono">{walletSummary.txCount}</span>
                      </div>
                      <div>
                        <span className="text-neutral-400">Risk Flags:</span>
                        <ul className="list-disc list-inside text-neutral-300 mt-1">
                          {walletSummary.riskFlags.map((flag, idx) => (
                            <li key={idx}>{flag}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <span className="text-neutral-400">Summary:</span>
                        <p className="mt-1 text-neutral-300">
                          {walletSummary.aiSummary}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Token Portfolio */}
                  {walletSummary.portfolio && walletSummary.portfolio.length > 0 && (
                    <div className="bg-neutral-950/80 border border-neutral-800 rounded-xl p-4">
                      <div className="mb-2 text-neutral-400 font-semibold">
                        Token Portfolio
                      </div>
                      {walletSummary.portfolio.map((t, idx) => (
                        <div
                          key={idx}
                          className="mb-2 border-b border-neutral-800 pb-2 last:border-b-0"
                        >
                          <div>
                            <span className="text-neutral-400">Token:</span>{" "}
                            <span className="font-mono">{t.symbol}</span>
                          </div>
                          <div>
                            <span className="text-neutral-400">Amount:</span>{" "}
                            <span className="font-mono">{t.amount}</span>
                          </div>
                          <div>
                            <span className="text-neutral-400">Value (USD):</span>{" "}
                            <span className="font-mono">
                              ${t.amountUsd.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Approvals */}
                  {approvals && approvals.approvals && (
                    <div className="bg-neutral-950/80 border border-neutral-800 rounded-xl p-4">
                      <div className="mb-2 text-neutral-400 font-semibold">
                        Token Approvals
                      </div>
                      {approvals.approvals.length === 0 && (
                        <div className="text-neutral-500 text-[11px]">
                          No tracked approvals detected for curated tokens and protocols.
                        </div>
                      )}
                      {approvals.approvals.map((a, idx) => (
                        <div
                          key={idx}
                          className="mb-2 border-b border-neutral-800 pb-2 last:border-b-0"
                        >
                          <div>
                            <span className="text-neutral-400">Token:</span>{" "}
                            <span className="font-mono">{a.token}</span>
                          </div>
                          <div>
                            <span className="text-neutral-400">Spender:</span>{" "}
                            <span className="font-mono break-all">
                              {a.spender}
                            </span>
                          </div>
                          <div className="text-[11px] text-neutral-500">
                            {a.spenderLabel}
                          </div>
                          <div>
                            <span className="text-neutral-400">Approved Amount:</span>{" "}
                            <span className="font-mono">{a.amount}</span>
                          </div>
                          <div>
                            <span className="text-neutral-400">Unlimited:</span>{" "}
                            <span className="font-mono">
                              {a.unlimited ? "Yes" : "No"}
                            </span>
                          </div>
                          <div>
                            <span className="text-neutral-400">Risk:</span>{" "}
                            <span
                              className={`font-mono ${
                                a.risk === "high"
                                  ? "text-red-400"
                                  : a.risk === "medium"
                                  ? "text-amber-400"
                                  : "text-emerald-400"
                              }`}
                            >
                              {a.risk}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Allocation + Risk + Exposure + Notes + Timeline */}
            {walletSummary && (
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 text-xs">
                {/* Allocation */}
                <div className="bg-neutral-950/80 border border-neutral-800 rounded-xl p-4 lg:col-span-1">
                  <div className="mb-2 text-neutral-400 font-semibold">
                    Allocation
                  </div>
                  {allocation && allocation.length > 0 ? (
                    <>
                      <div className="w-full h-2 rounded-full bg-neutral-800 overflow-hidden mb-2 flex">
                        {allocation.map((part, idx) => (
                          <div
                            key={idx}
                            className={`${part.color}`}
                            style={{ width: `${part.pct}%` }}
                          />
                        ))}
                      </div>
                      <div className="space-y-1">
                        {allocation.map((part, idx) => (
                          <div key={idx} className="flex justify-between">
                            <span className="text-neutral-300">
                              {part.label}
                            </span>
                            <span className="font-mono text-neutral-400">
                              {part.pct.toFixed(1)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="text-neutral-500">
                      Not enough data to compute allocation.
                    </div>
                  )}
                </div>

                {/* Risk Breakdown */}
                <div className="bg-neutral-950/80 border border-neutral-800 rounded-xl p-4 lg:col-span-1">
                  <div className="mb-2 text-neutral-400 font-semibold">
                    Risk Breakdown
                  </div>
                  {riskBreakdown && riskBreakdown.length > 0 ? (
                    <div className="space-y-2">
                      {riskBreakdown.map((r, idx) => (
                        <div key={idx} className="border border-neutral-800 rounded-lg p-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-neutral-300">{r.label}</span>
                            <span className="font-mono text-neutral-400">
                              {r.score}/100
                            </span>
                          </div>
                          <p className="text-neutral-500 text-[11px]">
                            {r.notes}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-neutral-500">
                      Risk breakdown unavailable.
                    </div>
                  )}
                </div>

                {/* Protocol Exposure + Smart Notes */}
                <div className="bg-neutral-950/80 border border-neutral-800 rounded-xl p-4 lg:col-span-1">
                  <div className="mb-2 text-neutral-400 font-semibold">
                    Insights
                  </div>
                  {protocolExposure && protocolExposure.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[11px] text-neutral-500 mb-1">
                        Protocol / Category Exposure
                      </div>
                      <div className="space-y-1">
                        {protocolExposure.map((p, idx) => (
                          <div key={idx} className="border border-neutral-800 rounded-lg p-2">
                            <div className="flex items-center justify-between">
                              <span className="text-neutral-300">
                                {p.label}
                              </span>
                              <span className="font-mono text-neutral-400">
                                ${p.usd.toFixed(2)}
                              </span>
                            </div>
                            <p className="text-[11px] text-neutral-500 mt-1">
                              {p.note}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {smartNotes && smartNotes.length > 0 && (
                    <div>
                      <div className="text-[11px] text-neutral-500 mb-1">
                        Smart Notes
                      </div>
                      <ul className="list-disc list-inside text-[11px] text-neutral-300 space-y-1">
                        {smartNotes.map((n, idx) => (
                          <li key={idx}>{n}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {!protocolExposure?.length && !smartNotes?.length && (
                    <div className="text-neutral-500 text-[11px]">
                      No additional insights available yet.
                    </div>
                  )}
                </div>

                {/* Wallet Timeline */}
                <div className="bg-neutral-950/80 border border-neutral-800 rounded-xl p-4 lg:col-span-1">
                  <div className="mb-2 text-neutral-400 font-semibold">
                    Wallet Timeline
                  </div>
                  {walletSummary.activity && walletSummary.activity.length > 0 ? (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {walletSummary.activity.map((ev, idx) => (
                        <div key={idx} className="border border-neutral-800 rounded-lg p-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-neutral-300">
                              {ev.type === "token_transfer" ? "Token Transfer" : "Activity"}
                            </span>
                            <span
                              className={`text-[10px] ${
                                ev.direction === "in"
                                  ? "text-emerald-400"
                                  : "text-red-400"
                              }`}
                            >
                              {ev.direction === "in" ? "IN" : "OUT"}
                            </span>
                          </div>
                          <div className="text-[11px] text-neutral-400">
                            {ev.amount} {ev.token}
                          </div>
                          <div className="text-[10px] text-neutral-500 mt-1">
                            Block {ev.blockNumber} ·{" "}
                            <span className="font-mono break-all">
                              {ev.txHash.slice(0, 10)}...
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-neutral-500 text-[11px]">
                      No recent tracked activity for curated tokens in the last few thousand blocks.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-6 text-center text-red-400 text-sm">
            {error}
          </div>
        )}
      </div>

      <style>{`
        @keyframes scan {
          0% { transform: translateY(0); opacity: 0.4; }
          50% { opacity: 1; }
          100% { transform: translateY(100vh); opacity: 0; }
        }
        @keyframes glow {
          0% { box-shadow: 0 0 0 rgba(128,0,255,0.0); }
          50% { box-shadow: 0 0 25px rgba(128,0,255,0.4); }
          100% { box-shadow: 0 0 0 rgba(128,0,255,0.0); }
        }
      `}</style>
    </div>
  );
}

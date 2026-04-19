import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { ROUTES } from "@/api/routes";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TreasuryState {
    totalUsd: number;
    auraPrice: number;
    auraMarketCapUsd: number;
    lastBuybackAmountUsd?: number;
    lastBuybackTxHash?: string;
    performanceFeeAccruedUsd: number;
}

interface TradeRecord {
    tradeId: string;
    timestamp: number;
    pair: string;
    direction: "long" | "short";
    sizeUsd: number;
    result: { pnlUsd?: number; isProfit?: boolean; txHash?: string };
    invoice?: { performanceFeeUsd: number; onChainProof: string } | null;
    consensus?: { finalDecision: { confidence: number; reasoning: string } };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2) {
    return n.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}

function shortHash(hash: string) {
    if (!hash || hash.length < 12) return hash;
    return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

function bscLink(hash: string) {
    return `https://bscscan.com/tx/${hash}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
    label,
    value,
    sub,
    accent,
}: {
    label: string;
    value: string;
    sub?: string;
    accent?: "green" | "red" | "blue" | "yellow";
}) {
    const accentClass = {
        green: "border-green-500/40 bg-green-950/20",
        red: "border-red-500/40 bg-red-950/20",
        blue: "border-blue-500/40 bg-blue-950/20",
        yellow: "border-yellow-500/40 bg-yellow-950/20",
    }[accent ?? "blue"];

    return (
        <div
            className={`rounded-xl border p-4 flex flex-col gap-1 ${accentClass}`}
        >
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
                {label}
            </span>
            <span className="text-2xl font-bold font-mono">{value}</span>
            {sub && (
                <span className="text-xs text-muted-foreground">{sub}</span>
            )}
        </div>
    );
}

function TradeRow({ trade }: { trade: TradeRecord }) {
    const pnl = trade.result.pnlUsd ?? 0;
    const isProfit = trade.result.isProfit;
    const confidence = trade.consensus?.finalDecision.confidence ?? 0;

    return (
        <tr className="border-b border-border/40 hover:bg-muted/20 transition-colors">
            <td className="py-2 px-3 font-mono text-xs text-muted-foreground">
                {new Date(trade.timestamp).toLocaleTimeString()}
            </td>
            <td className="py-2 px-3 font-semibold">{trade.pair}</td>
            <td className="py-2 px-3">
                <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        trade.direction === "long"
                            ? "bg-green-500/20 text-green-400"
                            : "bg-red-500/20 text-red-400"
                    }`}
                >
                    {trade.direction.toUpperCase()}
                </span>
            </td>
            <td className="py-2 px-3 font-mono text-sm">
                ${fmt(trade.sizeUsd)}
            </td>
            <td
                className={`py-2 px-3 font-mono font-bold text-sm ${
                    isProfit ? "text-green-400" : "text-red-400"
                }`}
            >
                {isProfit ? "+" : ""}${fmt(pnl)}
            </td>
            <td className="py-2 px-3 font-mono text-xs text-muted-foreground">
                {(confidence * 100).toFixed(0)}%
            </td>
            <td className="py-2 px-3">
                {trade.result.txHash ? (
                    <a
                        href={bscLink(trade.result.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-400 hover:text-blue-300 font-mono underline"
                    >
                        {shortHash(trade.result.txHash)}
                    </a>
                ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                )}
            </td>
        </tr>
    );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function AuraLensDashboard() {
    const { agentId } = useParams<{ agentId: string }>();

    const [treasury, setTreasury] = useState<TreasuryState | null>(null);
    const [trades, setTrades] = useState<TradeRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [cycling, setCycling] = useState(false);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

    const fetchData = useCallback(async () => {
        if (!agentId) return;
        try {
            const [tRes, trRes] = await Promise.all([
                fetch(ROUTES.treasury(agentId)),
                fetch(ROUTES.trades(agentId)),
            ]);

            if (tRes.ok) setTreasury(await tRes.json());
            if (trRes.ok) setTrades(await trRes.json());
            setLastUpdate(new Date());
        } catch {
            // silently fail — dashboard still renders with stale data
        } finally {
            setLoading(false);
        }
    }, [agentId]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30_000); // refresh every 30s
        return () => clearInterval(interval);
    }, [fetchData]);

    const runTradeCycle = async () => {
        if (!agentId || cycling) return;
        setCycling(true);
        try {
            await fetch(ROUTES.tradeCycle(agentId), { method: "POST" });
            setTimeout(fetchData, 5000); // refresh after 5s
        } finally {
            setCycling(false);
        }
    };

    // ── Computed stats ────────────────────────────────────────────────────────
    const totalTrades = trades.length;
    const profitableTrades = trades.filter((t) => t.result.isProfit).length;
    const winRate =
        totalTrades > 0 ? (profitableTrades / totalTrades) * 100 : 0;
    const totalPnl = trades.reduce((s, t) => s + (t.result.pnlUsd ?? 0), 0);
    const totalFees = trades.reduce(
        (s, t) => s + (t.invoice?.performanceFeeUsd ?? 0),
        0
    );

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center min-h-screen">
                <div className="text-muted-foreground animate-pulse">
                    Loading AuraLens dashboard...
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 p-6 space-y-6 max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">
                        AuraLens
                        <span className="ml-2 text-sm font-normal text-muted-foreground">
                            Verifiable Sovereign AI Hedge Fund
                        </span>
                    </h1>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        BNB Chain · MYX V2 · DGrid · Pieverse · Four.meme
                        {lastUpdate && (
                            <span className="ml-2">
                                · Updated {lastUpdate.toLocaleTimeString()}
                            </span>
                        )}
                    </p>
                </div>
                <button
                    onClick={runTradeCycle}
                    disabled={cycling}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
                >
                    {cycling ? "Running cycle..." : "▶ Run Trade Cycle"}
                </button>
            </div>

            {/* Treasury stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    label="Treasury"
                    value={`$${fmt(treasury?.totalUsd ?? 0)}`}
                    sub="USDT on BNB Chain"
                    accent="blue"
                />
                <StatCard
                    label="$AURA Price"
                    value={`$${(treasury?.auraPrice ?? 0).toFixed(6)}`}
                    sub={`MCap $${fmt(treasury?.auraMarketCapUsd ?? 0, 0)}`}
                    accent="yellow"
                />
                <StatCard
                    label="Total PnL"
                    value={`${totalPnl >= 0 ? "+" : ""}$${fmt(totalPnl)}`}
                    sub={`${totalTrades} trades`}
                    accent={totalPnl >= 0 ? "green" : "red"}
                />
                <StatCard
                    label="Win Rate"
                    value={`${winRate.toFixed(1)}%`}
                    sub={`${profitableTrades}/${totalTrades} profitable`}
                    accent={winRate >= 50 ? "green" : "red"}
                />
            </div>

            {/* Secondary stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <StatCard
                    label="Performance Fees"
                    value={`$${fmt(totalFees)}`}
                    sub="5% of gross PnL"
                    accent="yellow"
                />
                <StatCard
                    label="$AURA Buybacks"
                    value={`$${fmt(treasury?.performanceFeeAccruedUsd ?? totalFees)}`}
                    sub={
                        treasury?.lastBuybackTxHash
                            ? shortHash(treasury.lastBuybackTxHash)
                            : "No buybacks yet"
                    }
                    accent="green"
                />
                <StatCard
                    label="Last Buyback"
                    value={
                        treasury?.lastBuybackAmountUsd
                            ? `$${fmt(treasury.lastBuybackAmountUsd)}`
                            : "—"
                    }
                    sub={
                        treasury?.lastBuybackTxHash ? (
                            <a
                                href={bscLink(treasury.lastBuybackTxHash)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 underline"
                            >
                                View on BscScan
                            </a>
                        ) as any : "Pending first trade"
                    }
                    accent="blue"
                />
            </div>

            {/* Trade history */}
            <div className="rounded-xl border border-border/60 overflow-hidden">
                <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
                    <h2 className="font-semibold text-sm">Trade History</h2>
                    <span className="text-xs text-muted-foreground">
                        All trades verifiable on BscScan
                    </span>
                </div>
                {trades.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground text-sm">
                        No trades yet. Click "Run Trade Cycle" to start.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border/40 text-xs text-muted-foreground">
                                    <th className="py-2 px-3 text-left">Time</th>
                                    <th className="py-2 px-3 text-left">Pair</th>
                                    <th className="py-2 px-3 text-left">Dir</th>
                                    <th className="py-2 px-3 text-left">Size</th>
                                    <th className="py-2 px-3 text-left">PnL</th>
                                    <th className="py-2 px-3 text-left">Conf</th>
                                    <th className="py-2 px-3 text-left">Tx</th>
                                </tr>
                            </thead>
                            <tbody>
                                {trades.map((t) => (
                                    <TradeRow key={t.tradeId} trade={t} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* On-chain audit note */}
            <div className="rounded-xl border border-border/40 bg-muted/10 p-4 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                    🔗 Full On-Chain Audit Trail
                </span>{" "}
                — Every trade decision, invoice, and buyback is recorded on BNB
                Chain. Model reasoning logs are stored in Unibase and referenced
                by content hash. Profit-Sharing Invoices are issued via Pieverse
                x402b. All verifiable, all transparent.
            </div>
        </div>
    );
}

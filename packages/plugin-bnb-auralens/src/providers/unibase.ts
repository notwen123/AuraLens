/**
 * Unibase Persistent Memory Provider
 * Stores trade history, model logs, and agent learnings for continuous improvement.
 * All data is content-addressed and retrievable for on-chain audit.
 */

import { IAgentRuntime, elizaLogger } from "@elizaos/core";
import type {
    DGridConsensusResult,
    MYXTradeResult,
    ProfitSharingInvoice,
    TreasuryState,
} from "../types.js";

const UNIBASE_BASE = "https://api.unibase.ai/v1";

interface TradeRecord {
    tradeId: string;
    timestamp: number;
    pair: string;
    direction: "long" | "short";
    sizeUsd: number;
    consensus: DGridConsensusResult;
    result: MYXTradeResult;
    invoice?: ProfitSharingInvoice | null;
    treasury?: TreasuryState;
}

async function unibaseRequest(
    runtime: IAgentRuntime,
    method: "GET" | "POST",
    path: string,
    body?: object
): Promise<any> {
    const apiKey = runtime.getSetting("UNIBASE_API_KEY");
    const baseUrl = runtime.getSetting("UNIBASE_API_URL") ?? UNIBASE_BASE;

    if (!apiKey) {
        elizaLogger.warn("[Unibase] UNIBASE_API_KEY not set, skipping persistence");
        return null;
    }

    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Unibase API error [${res.status}]: ${err}`);
    }

    return res.json();
}

/**
 * Persist a complete trade record to Unibase.
 * Returns the content hash (CID) for on-chain reference.
 */
export async function persistTradeRecord(
    runtime: IAgentRuntime,
    record: TradeRecord
): Promise<string | null> {
    try {
        const result = await unibaseRequest(runtime, "POST", "/store", {
            namespace: "auralens:trades",
            key: record.tradeId,
            data: record,
            ttl: 0, // permanent
        });

        const cid = result?.cid ?? result?.hash ?? null;
        elizaLogger.info(`[Unibase] Trade persisted: ${record.tradeId} → CID=${cid}`);
        return cid;
    } catch (err) {
        elizaLogger.error("[Unibase] Failed to persist trade:", err);
        return null;
    }
}

/**
 * Retrieve recent trade history for agent learning context.
 */
export async function getRecentTrades(
    runtime: IAgentRuntime,
    limit = 20
): Promise<TradeRecord[]> {
    try {
        const result = await unibaseRequest(
            runtime,
            "GET",
            `/query?namespace=auralens:trades&limit=${limit}&sort=desc`
        );
        return (result?.items ?? []) as TradeRecord[];
    } catch (err) {
        elizaLogger.error("[Unibase] Failed to fetch trade history:", err);
        return [];
    }
}

/**
 * Build a learning context string from recent trades for the LLM.
 * Injected into DGrid prompts to improve decision quality over time.
 */
export async function buildLearningContext(
    runtime: IAgentRuntime
): Promise<string> {
    const trades = await getRecentTrades(runtime, 10);
    if (trades.length === 0) return "";

    const winRate =
        trades.filter((t) => t.result.isProfit).length / trades.length;
    const avgPnl =
        trades.reduce((sum, t) => sum + (t.result.pnlUsd ?? 0), 0) /
        trades.length;

    const recentSummary = trades
        .slice(0, 5)
        .map(
            (t) =>
                `- ${t.pair} ${t.direction}: PnL=$${(t.result.pnlUsd ?? 0).toFixed(2)}, confidence=${t.consensus.finalDecision.confidence.toFixed(2)}`
        )
        .join("\n");

    return `
Historical Performance (last ${trades.length} trades):
- Win rate: ${(winRate * 100).toFixed(1)}%
- Avg PnL: $${avgPnl.toFixed(2)}

Recent trades:
${recentSummary}
`.trim();
}

/**
 * Persist treasury state snapshot.
 */
export async function persistTreasurySnapshot(
    runtime: IAgentRuntime,
    state: TreasuryState
): Promise<void> {
    try {
        await unibaseRequest(runtime, "POST", "/store", {
            namespace: "auralens:treasury",
            key: `snapshot_${Date.now()}`,
            data: state,
            ttl: 0,
        });
    } catch (err) {
        elizaLogger.error("[Unibase] Failed to persist treasury snapshot:", err);
    }
}

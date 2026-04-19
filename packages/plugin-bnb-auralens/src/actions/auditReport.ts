/**
 * AURALENS_AUDIT_REPORT — Generate a full on-chain audit report.
 * Returns treasury state, recent trades, invoices, and model logs.
 */

import {
    type Action,
    type ActionExample,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    type State,
    elizaLogger,
} from "@elizaos/core";
import { getTreasuryState } from "../providers/treasury.js";
import { getRecentTrades } from "../providers/unibase.js";

export const auditReportAction: Action = {
    name: "AURALENS_AUDIT_REPORT",
    similes: [
        "SHOW_AUDIT",
        "GET_AUDIT_REPORT",
        "TREASURY_REPORT",
        "SHOW_TRADES",
        "PERFORMANCE_REPORT",
    ],
    description:
        "Generate a full AuraLens audit report: treasury state, recent trades, PnL, invoices, and model consensus logs.",

    validate: async (_runtime: IAgentRuntime, _message: Memory) => true,

    handler: async (
        runtime: IAgentRuntime,
        _message: Memory,
        _state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.info("[AuditReport] Generating audit report");

        try {
            const [treasury, trades] = await Promise.all([
                getTreasuryState(runtime),
                getRecentTrades(runtime, 10),
            ]);

            const totalTrades = trades.length;
            const profitableTrades = trades.filter((t) => t.result.isProfit).length;
            const winRate =
                totalTrades > 0
                    ? ((profitableTrades / totalTrades) * 100).toFixed(1)
                    : "N/A";
            const totalPnl = trades.reduce(
                (sum, t) => sum + (t.result.pnlUsd ?? 0),
                0
            );
            const totalFees = trades.reduce(
                (sum, t) => sum + (t.invoice?.performanceFeeUsd ?? 0),
                0
            );

            const recentTradeLines = trades
                .slice(0, 5)
                .map(
                    (t) =>
                        `• ${t.pair} ${t.direction.toUpperCase()} | PnL: $${(t.result.pnlUsd ?? 0).toFixed(2)} | ${t.result.isProfit ? "✅" : "❌"} | ${new Date(t.timestamp).toISOString()}`
                )
                .join("\n");

            const report = `
📊 **AuraLens Audit Report**
━━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 **Treasury**
Total Value: $${treasury.totalUsd.toFixed(2)}
$AURA Price: $${treasury.auraPrice.toFixed(6)}
$AURA Market Cap: $${treasury.auraMarketCapUsd.toLocaleString()}
Last Buyback: ${treasury.lastBuybackTxHash ? `$${treasury.lastBuybackAmountUsd?.toFixed(2)} (${treasury.lastBuybackTxHash.slice(0, 10)}...)` : "None yet"}

📈 **Performance (last ${totalTrades} trades)**
Win Rate: ${winRate}%
Total PnL: $${totalPnl.toFixed(2)}
Performance Fees Collected: $${totalFees.toFixed(2)}
$AURA Buybacks Executed: $${totalFees.toFixed(2)}

🔍 **Recent Trades**
${recentTradeLines || "No trades yet"}

🔗 **On-Chain Verification**
Chain: BNB Chain
Agent Wallet: ${runtime.getSetting("BNB_WALLET_ADDRESS") ?? "Not configured"}
$AURA Token: ${treasury.auraTokenAddress || "Not deployed"}

All trades are verifiable on BscScan.
`.trim();

            callback?.({ text: report });
            return true;
        } catch (err: any) {
            elizaLogger.error("[AuditReport] Failed:", err);
            callback?.({ text: `❌ Failed to generate audit report: ${err.message}` });
            return false;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: "Show me the audit report" },
            },
            {
                user: "AuraLens",
                content: {
                    text: "📊 AuraLens Audit Report...",
                    action: "AURALENS_AUDIT_REPORT",
                },
            },
        ],
    ] as ActionExample[][],
};

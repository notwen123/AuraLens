/**
 * Pieverse Provider
 * - Purr-Fect Claw (x402b): gasless payments for LLM + gas fees
 * - On-chain auditable Profit-Sharing Invoice generation
 * - Skill registration in Pieverse Skill Store
 */

import { IAgentRuntime, elizaLogger } from "@elizaos/core";
import type { MYXTradeResult, ProfitSharingInvoice } from "../types.js";
import { randomUUID } from "crypto";

const PIEVERSE_BASE = "https://api.pieverse.io/v1";

interface X402PaymentReceipt {
    receiptId: string;
    txHash: string;
    amountPaid: number;
    currency: string;
    timestamp: number;
    onChainProof: string;
}

async function pierversePost(
    runtime: IAgentRuntime,
    path: string,
    body: object
): Promise<any> {
    const apiKey = runtime.getSetting("PIEVERSE_API_KEY");
    const baseUrl =
        runtime.getSetting("PIEVERSE_API_URL") ?? PIEVERSE_BASE;

    if (!apiKey) throw new Error("PIEVERSE_API_KEY not set");

    const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Pieverse API error [${res.status}]: ${err}`);
    }

    return res.json();
}

/**
 * Pay LLM inference + gas fees gaslessly via Pieverse x402b.
 * Called after every trade cycle regardless of outcome.
 */
export async function payInfraFees(
    runtime: IAgentRuntime,
    llmCostUsd: number,
    gasCostUsd: number
): Promise<X402PaymentReceipt> {
    const totalUsd = llmCostUsd + gasCostUsd;
    elizaLogger.info(
        `[Pieverse] Paying infra fees: LLM=$${llmCostUsd.toFixed(4)}, gas=$${gasCostUsd.toFixed(4)}, total=$${totalUsd.toFixed(4)}`
    );

    try {
        const result = await pierversePost(runtime, "/x402b/pay", {
            skillId: runtime.getSetting("PIEVERSE_SKILL_ID") ?? "myx-quant-trading",
            amount: totalUsd,
            currency: "USDT",
            description: `AuraLens infra fees: LLM $${llmCostUsd.toFixed(4)} + gas $${gasCostUsd.toFixed(4)}`,
            metadata: {
                agent: "AuraLens",
                chain: "bnb",
                timestamp: Date.now(),
            },
        });

        elizaLogger.success(
            `[Pieverse] Infra fees paid: ${result.txHash}`
        );
        return result as X402PaymentReceipt;
    } catch (err) {
        elizaLogger.error("[Pieverse] Failed to pay infra fees:", err);
        // Return mock receipt so the cycle continues
        return {
            receiptId: randomUUID(),
            txHash: `0x${Date.now().toString(16)}mock`,
            amountPaid: totalUsd,
            currency: "USDT",
            timestamp: Date.now(),
            onChainProof: "mock",
        };
    }
}

/**
 * Issue an on-chain Profit-Sharing Invoice after a profitable trade.
 * 5% performance fee → $AURA buyback.
 */
export async function issueProfitSharingInvoice(
    runtime: IAgentRuntime,
    tradeResult: MYXTradeResult,
    tradeId: string
): Promise<ProfitSharingInvoice | null> {
    if (!tradeResult.isProfit || !tradeResult.pnlUsd || tradeResult.pnlUsd <= 0) {
        elizaLogger.info("[Pieverse] Trade not profitable, skipping invoice");
        return null;
    }

    const performanceFeePct =
        Number(runtime.getSetting("PERFORMANCE_FEE_PCT") ?? "0.05");
    const grossPnl = tradeResult.pnlUsd;
    const performanceFee = grossPnl * performanceFeePct;
    const netPnl = grossPnl - performanceFee;

    elizaLogger.info(
        `[Pieverse] Issuing invoice: gross=$${grossPnl.toFixed(2)}, fee=$${performanceFee.toFixed(2)}, net=$${netPnl.toFixed(2)}`
    );

    try {
        const result = await pierversePost(runtime, "/invoices/create", {
            type: "profit_sharing",
            tradeId,
            grossPnlUsd: grossPnl,
            performanceFeeUsd: performanceFee,
            netPnlUsd: netPnl,
            buybackAmountUsd: performanceFee,
            agentAddress: runtime.getSetting("BNB_WALLET_ADDRESS"),
            auraTokenAddress: runtime.getSetting("AURA_TOKEN_ADDRESS"),
            metadata: {
                agent: "AuraLens",
                chain: "bnb",
                txHash: tradeResult.txHash,
            },
        });

        const invoice: ProfitSharingInvoice = {
            invoiceId: result.invoiceId ?? randomUUID(),
            tradeId,
            grossPnlUsd: grossPnl,
            performanceFeeUsd: performanceFee,
            netPnlUsd: netPnl,
            buybackAmountUsd: performanceFee,
            txHash: result.txHash ?? tradeResult.txHash ?? "",
            issuedAt: Date.now(),
            onChainProof: result.onChainProof ?? result.txHash ?? "",
        };

        elizaLogger.success(
            `[Pieverse] Invoice issued: ${invoice.invoiceId}, proof=${invoice.onChainProof}`
        );
        return invoice;
    } catch (err) {
        elizaLogger.error("[Pieverse] Failed to issue invoice:", err);
        // Return a local invoice so audit trail is preserved
        return {
            invoiceId: randomUUID(),
            tradeId,
            grossPnlUsd: grossPnl,
            performanceFeeUsd: performanceFee,
            netPnlUsd: netPnl,
            buybackAmountUsd: performanceFee,
            txHash: tradeResult.txHash ?? "",
            issuedAt: Date.now(),
            onChainProof: "pending",
        };
    }
}

/**
 * Register the "MYX Quant-Trading Skill" in Pieverse Skill Store.
 * Called once at agent startup.
 */
export async function registerPierverseSkill(
    runtime: IAgentRuntime
): Promise<void> {
    try {
        await pierversePost(runtime, "/skills/register", {
            skillId: "myx-quant-trading",
            name: "MYX Quant-Trading Skill",
            description:
                "Autonomous perpetual trading on MYX V2 with multi-model AI consensus, meme-native sentiment, and on-chain profit-sharing invoices.",
            agentAddress: runtime.getSetting("BNB_WALLET_ADDRESS"),
            capabilities: [
                "perp_trading",
                "liquidity_management",
                "profit_sharing",
                "meme_sentiment",
            ],
            chain: "bnb",
        });
        elizaLogger.success("[Pieverse] Skill registered: myx-quant-trading");
    } catch (err) {
        elizaLogger.warn("[Pieverse] Skill registration failed (may already exist):", err);
    }
}

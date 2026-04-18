/**
 * Four.meme Provider
 * Ingests real-time token launch data and cultural sentiment signals.
 * Used by the Analyst Agent for meme-native intelligence.
 */

import { IAgentRuntime, elizaLogger } from "@elizaos/core";
import NodeCache from "node-cache";
import type { FourMemeSignal } from "../types.js";

const cache = new NodeCache({ stdTTL: 60 }); // 1-minute cache

// Four.meme public API endpoints (BNB Chain)
const FOURMEME_API = "https://four.meme/api";

interface FourMemeToken {
    symbol: string;
    address: string;
    launchTime: number;
    initialLiquidity: number;
    volume24h: number;
    priceChange24h: number;
    holders: number;
    twitterMentions?: number;
    telegramMentions?: number;
}

function computeSentimentScore(token: FourMemeToken): number {
    // Composite score: price momentum + holder growth + social mentions
    const priceMomentum = Math.min(1, Math.max(-1, token.priceChange24h / 100));
    const holderScore = Math.min(1, token.holders / 1000);
    const socialScore = Math.min(
        1,
        ((token.twitterMentions ?? 0) + (token.telegramMentions ?? 0)) / 500
    );
    return priceMomentum * 0.5 + holderScore * 0.3 + socialScore * 0.2;
}

export async function getFourMemeSignals(
    runtime: IAgentRuntime,
    limit = 10
): Promise<FourMemeSignal[]> {
    const cacheKey = `fourmeme_trending_${limit}`;
    const cached = cache.get<FourMemeSignal[]>(cacheKey);
    if (cached) return cached;

    try {
        const apiUrl =
            runtime.getSetting("FOURMEME_API_URL") ?? FOURMEME_API;

        const res = await fetch(`${apiUrl}/tokens/trending?chain=bnb&limit=${limit}`, {
            headers: { Accept: "application/json" },
        });

        if (!res.ok) {
            elizaLogger.warn(`[FourMeme] API returned ${res.status}, using mock data`);
            return getMockSignals();
        }

        const data: FourMemeToken[] = await res.json();

        const signals: FourMemeSignal[] = data.map((token, idx) => ({
            tokenSymbol: token.symbol,
            launchTimestamp: token.launchTime,
            initialLiquidityUsd: token.initialLiquidity,
            socialMentions:
                (token.twitterMentions ?? 0) + (token.telegramMentions ?? 0),
            sentimentScore: computeSentimentScore(token),
            trendingRank: idx + 1,
        }));

        cache.set(cacheKey, signals);
        elizaLogger.info(`[FourMeme] Fetched ${signals.length} trending signals`);
        return signals;
    } catch (err) {
        elizaLogger.error("[FourMeme] Failed to fetch signals:", err);
        return getMockSignals();
    }
}

export async function getAuraBuybackQuote(
    runtime: IAgentRuntime,
    amountUsd: number
): Promise<{ estimatedAura: number; priceImpactPct: number; txData: string }> {
    const auraAddress =
        runtime.getSetting("AURA_TOKEN_ADDRESS") ?? "";

    if (!auraAddress) {
        throw new Error("AURA_TOKEN_ADDRESS not configured");
    }

    // Query PancakeSwap V3 router on BNB Chain for USDT → $AURA quote
    // In production this calls the on-chain quoter contract via viem
    elizaLogger.info(
        `[FourMeme] Getting buyback quote: $${amountUsd} → $AURA (${auraAddress})`
    );

    // Placeholder — real implementation calls PancakeSwap quoter
    return {
        estimatedAura: amountUsd / 0.001, // mock price $0.001/AURA
        priceImpactPct: 0.3,
        txData: "0x",
    };
}

// ── Mock data for dev/demo when Four.meme API is unavailable ─────────────────
function getMockSignals(): FourMemeSignal[] {
    return [
        {
            tokenSymbol: "PEPE2",
            launchTimestamp: Date.now() - 3600000,
            initialLiquidityUsd: 50000,
            socialMentions: 1200,
            sentimentScore: 0.72,
            trendingRank: 1,
        },
        {
            tokenSymbol: "WOJAK",
            launchTimestamp: Date.now() - 7200000,
            initialLiquidityUsd: 30000,
            socialMentions: 800,
            sentimentScore: 0.55,
            trendingRank: 2,
        },
        {
            tokenSymbol: "DOGE2",
            launchTimestamp: Date.now() - 1800000,
            initialLiquidityUsd: 80000,
            socialMentions: 2100,
            sentimentScore: 0.81,
            trendingRank: 3,
        },
    ];
}

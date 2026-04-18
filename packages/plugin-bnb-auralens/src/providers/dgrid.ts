/**
 * DGrid AI Gateway Provider
 * Multi-model consensus: Llama 3 (technical analysis) + GPT-4 (sentiment/meme)
 * All LLM calls are logged for on-chain auditability.
 */

import { IAgentRuntime, elizaLogger } from "@elizaos/core";
import type {
    DGridConsensusResult,
    FourMemeSignal,
    ModelCallLog,
    TradeSignal,
} from "../types.js";

const DGRID_BASE = "https://api.dgrid.ai/v1";

async function callDGridModel(
    apiKey: string,
    model: string,
    systemPrompt: string,
    userPrompt: string
): Promise<{ content: string; log: ModelCallLog }> {
    const start = Date.now();
    const res = await fetch(`${DGRID_BASE}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            temperature: 0.2,
            max_tokens: 512,
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`DGrid API error [${res.status}]: ${err}`);
    }

    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? "";

    const log: ModelCallLog = {
        model,
        provider: "dgrid",
        prompt: userPrompt,
        response: content,
        latencyMs: Date.now() - start,
        timestamp: Date.now(),
    };

    return { content, log };
}

function parseSignalFromLLM(
    raw: string,
    pair: string,
    memeScore = 0
): TradeSignal {
    // Expect JSON block from LLM
    try {
        const match = raw.match(/```json\s*([\s\S]*?)```/);
        const json = match ? JSON.parse(match[1]) : JSON.parse(raw);
        return {
            pair,
            direction: json.direction ?? "long",
            confidence: Math.min(1, Math.max(0, Number(json.confidence ?? 0.5))),
            reasoning: json.reasoning ?? "",
            technicalScore: Number(json.technicalScore ?? 0.5),
            sentimentScore: Number(json.sentimentScore ?? 0.5),
            memeScore,
            timestamp: Date.now(),
        };
    } catch {
        // Fallback: neutral signal
        return {
            pair,
            direction: "long",
            confidence: 0.3,
            reasoning: raw.slice(0, 200),
            technicalScore: 0.3,
            sentimentScore: 0.3,
            memeScore,
            timestamp: Date.now(),
        };
    }
}

export async function getDGridConsensus(
    runtime: IAgentRuntime,
    pair: string,
    marketContext: string,
    fourMemeSignals: FourMemeSignal[]
): Promise<DGridConsensusResult> {
    const apiKey = runtime.getSetting("DGRID_API_KEY");
    if (!apiKey) throw new Error("DGRID_API_KEY not set");

    const memeContext =
        fourMemeSignals.length > 0
            ? `\nFour.meme trending signals:\n${fourMemeSignals
                  .map(
                      (s) =>
                          `- ${s.tokenSymbol}: sentiment=${s.sentimentScore.toFixed(2)}, rank=${s.trendingRank}, liquidity=$${s.initialLiquidityUsd}`
                  )
                  .join("\n")}`
            : "";

    const memeScore =
        fourMemeSignals.length > 0
            ? fourMemeSignals.reduce((a, b) => a + b.sentimentScore, 0) /
              fourMemeSignals.length
            : 0;

    // ── Analyst Agent: Llama 3 — Technical Analysis ──────────────────────────
    const analystSystem = `You are a quantitative trading analyst specializing in BNB Chain DeFi perpetuals.
Analyze market data and return a JSON trading signal. Always respond with a JSON code block.`;

    const analystPrompt = `Analyze the following market data for ${pair} and provide a trading signal.

Market Context:
${marketContext}
${memeContext}

Respond ONLY with a JSON code block:
\`\`\`json
{
  "direction": "long" | "short",
  "confidence": 0.0-1.0,
  "technicalScore": 0.0-1.0,
  "sentimentScore": 0.0-1.0,
  "reasoning": "brief explanation"
}
\`\`\``;

    // ── Sentiment Agent: GPT-4 — Sentiment + Meme Intelligence ───────────────
    const sentimentSystem = `You are a crypto sentiment analyst with deep expertise in meme culture and social signals on BNB Chain.
Analyze sentiment and cultural momentum. Always respond with a JSON code block.`;

    const sentimentPrompt = `Evaluate sentiment and meme momentum for ${pair}.

Market Context:
${marketContext}
${memeContext}

Respond ONLY with a JSON code block:
\`\`\`json
{
  "direction": "long" | "short",
  "confidence": 0.0-1.0,
  "technicalScore": 0.0-1.0,
  "sentimentScore": 0.0-1.0,
  "reasoning": "brief explanation"
}
\`\`\``;

    const [analystResult, sentimentResult] = await Promise.all([
        callDGridModel(
            apiKey,
            runtime.getSetting("DGRID_ANALYST_MODEL") ?? "meta-llama/Llama-3-70b-instruct",
            analystSystem,
            analystPrompt
        ),
        callDGridModel(
            apiKey,
            runtime.getSetting("DGRID_SENTIMENT_MODEL") ?? "openai/gpt-4o",
            sentimentSystem,
            sentimentPrompt
        ),
    ]);

    const analystSignal = parseSignalFromLLM(analystResult.content, pair, memeScore);
    const sentimentSignal = parseSignalFromLLM(sentimentResult.content, pair, memeScore);

    // ── Consensus: weighted average (60% technical, 40% sentiment) ────────────
    const techWeight = 0.6;
    const sentWeight = 0.4;

    const combinedConfidence =
        analystSignal.confidence * techWeight +
        sentimentSignal.confidence * sentWeight;

    const agreementScore =
        analystSignal.direction === sentimentSignal.direction
            ? (analystSignal.confidence + sentimentSignal.confidence) / 2
            : Math.abs(
                  analystSignal.confidence * techWeight -
                      sentimentSignal.confidence * sentWeight
              );

    // Direction: majority vote weighted by confidence
    const longScore =
        (analystSignal.direction === "long" ? analystSignal.confidence * techWeight : 0) +
        (sentimentSignal.direction === "long" ? sentimentSignal.confidence * sentWeight : 0);
    const shortScore =
        (analystSignal.direction === "short" ? analystSignal.confidence * techWeight : 0) +
        (sentimentSignal.direction === "short" ? sentimentSignal.confidence * sentWeight : 0);

    const finalDirection: "long" | "short" = longScore >= shortScore ? "long" : "short";

    const finalDecision: TradeSignal = {
        pair,
        direction: finalDirection,
        confidence: combinedConfidence,
        reasoning: `Consensus [tech=${analystSignal.direction}@${analystSignal.confidence.toFixed(2)}, sentiment=${sentimentSignal.direction}@${sentimentSignal.confidence.toFixed(2)}]. ${analystSignal.reasoning}`,
        technicalScore:
            analystSignal.technicalScore * techWeight +
            sentimentSignal.technicalScore * sentWeight,
        sentimentScore:
            analystSignal.sentimentScore * techWeight +
            sentimentSignal.sentimentScore * sentWeight,
        memeScore,
        timestamp: Date.now(),
    };

    elizaLogger.info(
        `[DGrid] Consensus for ${pair}: ${finalDirection} @ confidence=${combinedConfidence.toFixed(2)}, agreement=${agreementScore.toFixed(2)}`
    );

    return {
        finalDecision,
        analystSignal,
        sentimentSignal,
        agreementScore,
        modelLogs: [analystResult.log, sentimentResult.log],
    };
}

/**
 * AURALENS_TRADE_CYCLE — The core autonomous trading action.
 *
 * Full end-to-end cycle:
 * 1. Ingest Four.meme signals + market data
 * 2. DGrid multi-model consensus (Llama 3 + GPT-4)
 * 3. Risk/compliance check (spending caps, timelocks)
 * 4. Execute on MYX V2 (open perp position)
 * 5. Monitor + close position
 * 6. Issue Profit-Sharing Invoice via Pieverse x402b
 * 7. Trigger $AURA buyback (5% performance fee)
 * 8. Persist to Unibase memory
 */

import {
    type Action,
    type ActionExample,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    type State,
    elizaLogger,
    composeContext,
    generateText,
    ModelClass,
} from "@elizaos/core";
import { randomUUID } from "crypto";
import { getDGridConsensus } from "../providers/dgrid.js";
import { getFourMemeSignals } from "../providers/fourmeme.js";
import { openMYXPosition, closeMYXPosition, getCurrentPrice, adjustLiquidityDepth } from "../providers/myx.js";
import { issueProfitSharingInvoice, payInfraFees } from "../providers/pieverse.js";
import { persistTradeRecord, buildLearningContext } from "../providers/unibase.js";
import {
    runRiskCheck,
    recordPositionOpened,
    recordPositionClosed,
    recordTradeResult,
} from "../providers/riskEngine.js";
import { executeBuyback } from "./buyback.js";
import { getTreasuryState } from "../providers/treasury.js";
import type { MYXPosition } from "../types.js";

const SUPPORTED_PAIRS = ["BTC/USDT", "ETH/USDT", "BNB/USDT"];

const marketContextTemplate = `You are analyzing market conditions for AuraLens autonomous trading.

Current market data:
{{marketData}}

Historical performance context:
{{learningContext}}

Four.meme trending signals:
{{memeSignals}}

Select the BEST trading pair and provide a brief market summary for the AI agents to analyze.
Respond with just the pair symbol (e.g. "BTC/USDT") on the first line, then a 2-3 sentence market summary.`;

export const tradeCycleAction: Action = {
    name: "AURALENS_TRADE_CYCLE",
    similes: [
        "RUN_TRADE_CYCLE",
        "EXECUTE_AUTONOMOUS_TRADE",
        "START_TRADING_CYCLE",
        "AURALENS_TRADE",
    ],
    description:
        "Execute a full AuraLens autonomous trading cycle: signal ingestion → multi-model consensus → risk check → MYX V2 execution → invoice → buyback → memory update.",

    validate: async (runtime: IAgentRuntime, _message: Memory) => {
        const required = ["BNB_PRIVATE_KEY", "DGRID_API_KEY"];
        for (const key of required) {
            if (!runtime.getSetting(key)) {
                elizaLogger.warn(`[TradeCycle] Missing required setting: ${key}`);
                return false;
            }
        }
        return true;
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: Record<string, unknown>,
        callback?: HandlerCallback
    ): Promise<boolean> => {
        const tradeId = randomUUID();
        elizaLogger.info(`[TradeCycle] Starting cycle ${tradeId}`);

        callback?.({
            text: `🔄 AuraLens trade cycle started (ID: ${tradeId.slice(0, 8)}...)`,
        });

        try {
            // ── Step 1: Get treasury state ────────────────────────────────────
            const treasury = await getTreasuryState(runtime);
            elizaLogger.info(
                `[TradeCycle] Treasury: $${treasury.totalUsd.toFixed(2)}`
            );

            // ── Step 2: Ingest Four.meme signals ──────────────────────────────
            const memeSignals = await getFourMemeSignals(runtime, 5);
            elizaLogger.info(
                `[TradeCycle] Got ${memeSignals.length} Four.meme signals`
            );

            // ── Step 3: Build market context with learning history ─────────────
            const learningContext = await buildLearningContext(runtime);

            const prices = await Promise.all(
                SUPPORTED_PAIRS.map(async (pair) => ({
                    pair,
                    price: await getCurrentPrice(runtime, pair),
                }))
            );

            const marketData = prices
                .map((p) => `${p.pair}: $${p.price.toLocaleString()}`)
                .join("\n");

            const memeSignalText = memeSignals
                .map(
                    (s) =>
                        `${s.tokenSymbol}: sentiment=${s.sentimentScore.toFixed(2)}, rank=${s.trendingRank}`
                )
                .join("\n");

            // ── Step 4: Select pair via LLM ───────────────────────────────────
            if (!state) state = (await runtime.composeState(message)) as State;
            const ctx = composeContext({
                state: {
                    ...state,
                    marketData,
                    learningContext,
                    memeSignals: memeSignalText,
                },
                template: marketContextTemplate,
            });

            const pairSelection = await generateText({
                runtime,
                context: ctx,
                modelClass: ModelClass.SMALL,
            });

            const selectedPair =
                SUPPORTED_PAIRS.find((p) => pairSelection.includes(p)) ??
                "BTC/USDT";
            const marketSummary = pairSelection
                .split("\n")
                .slice(1)
                .join(" ")
                .trim();

            elizaLogger.info(`[TradeCycle] Selected pair: ${selectedPair}`);

            // ── Step 5: DGrid multi-model consensus ───────────────────────────
            callback?.({
                text: `🧠 Running DGrid consensus for ${selectedPair}...`,
            });

            const fullContext = `${marketSummary}\n\nMarket prices:\n${marketData}\n\n${learningContext}`;
            const consensus = await getDGridConsensus(
                runtime,
                selectedPair,
                fullContext,
                memeSignals
            );

            elizaLogger.info(
                `[TradeCycle] Consensus: ${consensus.finalDecision.direction} @ ${consensus.finalDecision.confidence.toFixed(2)}`
            );

            // ── Step 6: Adjust MYX liquidity depth based on sentiment ─────────
            await adjustLiquidityDepth(
                runtime,
                selectedPair,
                consensus.finalDecision.sentimentScore
            );

            // ── Step 7: Risk check ────────────────────────────────────────────
            const riskResult = await runRiskCheck(
                runtime,
                consensus.finalDecision,
                consensus.agreementScore,
                treasury
            );

            if (!riskResult.approved) {
                callback?.({
                    text: `🛡️ Risk check failed: ${riskResult.reason}. No trade executed.`,
                });

                await persistTradeRecord(runtime, {
                    tradeId,
                    timestamp: Date.now(),
                    pair: selectedPair,
                    direction: consensus.finalDecision.direction,
                    sizeUsd: 0,
                    consensus,
                    result: {
                        success: false,
                        error: `Risk denied: ${riskResult.reason}`,
                    },
                    treasury,
                });

                return true;
            }

            callback?.({
                text: `✅ Risk approved: ${selectedPair} ${consensus.finalDecision.direction.toUpperCase()} $${riskResult.cappedSizeUsd.toFixed(2)}`,
            });

            // ── Step 8: Open MYX V2 position ──────────────────────────────────
            const openResult = await openMYXPosition(
                runtime,
                consensus.finalDecision,
                riskResult.cappedSizeUsd
            );

            if (!openResult.success) {
                callback?.({
                    text: `❌ Failed to open position: ${openResult.error}`,
                });
                return false;
            }

            recordPositionOpened();

            const position: MYXPosition = {
                positionId: openResult.positionId!,
                pair: selectedPair,
                direction: consensus.finalDecision.direction,
                sizeUsd: riskResult.cappedSizeUsd,
                entryPrice: prices.find((p) => p.pair === selectedPair)?.price ?? 0,
                leverage: Number(runtime.getSetting("MYX_DEFAULT_LEVERAGE") ?? "5"),
                openedAt: Date.now(),
                txHash: openResult.txHash!,
            };

            callback?.({
                text: `📈 Position opened on MYX V2!\nPair: ${position.pair}\nDirection: ${position.direction.toUpperCase()}\nSize: $${position.sizeUsd.toFixed(2)}\nTx: ${position.txHash}`,
            });

            // ── Step 9: Hold position for configured duration ─────────────────
            const holdMs = Number(
                runtime.getSetting("TRADE_HOLD_MS") ?? "300000" // 5 min default
            );
            elizaLogger.info(
                `[TradeCycle] Holding position for ${holdMs / 1000}s...`
            );
            await new Promise((r) => setTimeout(r, holdMs));

            // ── Step 10: Close position ───────────────────────────────────────
            const closeResult = await closeMYXPosition(runtime, position);
            recordPositionClosed();

            if (!closeResult.success) {
                callback?.({
                    text: `❌ Failed to close position: ${closeResult.error}`,
                });
                return false;
            }

            recordTradeResult(closeResult.pnlUsd ?? 0);

            const pnlEmoji = closeResult.isProfit ? "💰" : "📉";
            callback?.({
                text: `${pnlEmoji} Position closed!\nPnL: $${(closeResult.pnlUsd ?? 0).toFixed(2)}\nTx: ${closeResult.txHash}`,
            });

            // ── Step 11: Pay infra fees via Pieverse x402b ────────────────────
            const llmCostUsd = consensus.modelLogs.length * 0.002; // ~$0.002/call
            const gasCostUsd = 0.05; // ~$0.05 BNB gas
            await payInfraFees(runtime, llmCostUsd, gasCostUsd);

            // ── Step 12: Issue Profit-Sharing Invoice (if profitable) ─────────
            const invoice = await issueProfitSharingInvoice(
                runtime,
                closeResult,
                tradeId
            );

            if (invoice) {
                callback?.({
                    text: `🧾 Profit-Sharing Invoice issued!\nGross PnL: $${invoice.grossPnlUsd.toFixed(2)}\nPerformance Fee (5%): $${invoice.performanceFeeUsd.toFixed(2)}\nNet PnL: $${invoice.netPnlUsd.toFixed(2)}\nProof: ${invoice.onChainProof}`,
                });

                // ── Step 13: $AURA buyback with performance fee ───────────────
                const buybackResult = await executeBuyback(
                    runtime,
                    invoice.buybackAmountUsd
                );

                if (buybackResult.success) {
                    callback?.({
                        text: `🔄 $AURA Buyback executed!\nAmount: $${invoice.buybackAmountUsd.toFixed(2)}\nAURA bought: ${buybackResult.auraAmount?.toFixed(0)}\nTx: ${buybackResult.txHash}`,
                    });
                }
            }

            // ── Step 14: Persist full record to Unibase ───────────────────────
            const cid = await persistTradeRecord(runtime, {
                tradeId,
                timestamp: Date.now(),
                pair: selectedPair,
                direction: consensus.finalDecision.direction,
                sizeUsd: riskResult.cappedSizeUsd,
                consensus,
                result: closeResult,
                invoice,
                treasury,
            });

            callback?.({
                text: `✅ Trade cycle complete!\nID: ${tradeId.slice(0, 8)}\nMemory CID: ${cid ?? "pending"}\nAll actions visible on BNB Chain explorer.`,
            });

            return true;
        } catch (err: any) {
            elizaLogger.error("[TradeCycle] Unhandled error:", err);
            callback?.({
                text: `❌ Trade cycle error: ${err.message}`,
            });
            return false;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: "Run a trade cycle" },
            },
            {
                user: "AuraLens",
                content: {
                    text: "🔄 AuraLens trade cycle started...",
                    action: "AURALENS_TRADE_CYCLE",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "Execute autonomous trade" },
            },
            {
                user: "AuraLens",
                content: {
                    text: "Starting full autonomous trading cycle with DGrid consensus...",
                    action: "AURALENS_TRADE_CYCLE",
                },
            },
        ],
    ] as ActionExample[][],
};

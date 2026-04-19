/**
 * @elizaos/plugin-bnb-auralens
 * AuraLens — Verifiable Sovereign AI Hedge Fund on BNB Chain
 *
 * Integrations:
 * - MYX V2: Perpetual DEX trading + liquidity management
 * - Pieverse: Gasless payments (x402b) + on-chain invoices + skill store
 * - DGrid: Multi-model AI consensus (Llama 3 + GPT-4)
 * - Four.meme: Meme-native sentiment signals
 * - Unibase: Persistent memory + trade history
 */

import type { Plugin } from "@elizaos/core";
import { tradeCycleAction } from "./actions/tradeCycle.js";
import { auditReportAction } from "./actions/auditReport.js";
import { AuraLensSchedulerService } from "./actions/scheduler.js";

export * from "./types.js";
export * from "./providers/dgrid.js";
export * from "./providers/fourmeme.js";
export * from "./providers/myx.js";
export * from "./providers/pieverse.js";
export * from "./providers/unibase.js";
export * from "./providers/riskEngine.js";
export * from "./providers/treasury.js";
export * from "./actions/buyback.js";

export const auraLensPlugin: Plugin = {
    name: "bnb-auralens",
    description:
        "AuraLens — Verifiable Sovereign AI Hedge Fund. Autonomous perpetual trading on MYX V2 with DGrid multi-model consensus, Four.meme meme intelligence, Pieverse gasless payments, and on-chain profit-sharing invoices.",
    actions: [tradeCycleAction, auditReportAction],
    providers: [],
    evaluators: [],
    services: [new AuraLensSchedulerService()],
    clients: [],
};

export default auraLensPlugin;

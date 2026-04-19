/**
 * AuraLens Autonomous Scheduler
 * Runs the trade cycle on a configurable interval without human intervention.
 * Registered as a Service so it starts with the agent runtime.
 */

import {
    Service,
    ServiceType,
    type IAgentRuntime,
    elizaLogger,
    stringToUuid,
} from "@elizaos/core";
import { tradeCycleAction } from "./tradeCycle.js";
import { registerPierverseSkill } from "../providers/pieverse.js";

// Use a custom service type string since we're extending the enum
const AURALENS_SERVICE_TYPE = "auralens_scheduler" as unknown as ServiceType;

export class AuraLensSchedulerService extends Service {
    static get serviceType(): ServiceType {
        return AURALENS_SERVICE_TYPE;
    }

    private intervalHandle: ReturnType<typeof setInterval> | null = null;
    private runtime: IAgentRuntime | null = null;

    async initialize(runtime: IAgentRuntime): Promise<void> {
        this.runtime = runtime;

        elizaLogger.info("[Scheduler] AuraLens scheduler initializing...");

        // Register Pieverse skill on startup
        await registerPierverseSkill(runtime);

        const intervalMs = Number(
            runtime.getSetting("TRADE_CYCLE_INTERVAL_MS") ?? "900000" // 15 min default
        );

        elizaLogger.info(
            `[Scheduler] Trade cycle interval: ${intervalMs / 60000} minutes`
        );

        // Run first cycle after a short delay to let everything initialize
        setTimeout(() => this.runCycle(), 10_000);

        // Then run on interval
        this.intervalHandle = setInterval(
            () => this.runCycle(),
            intervalMs
        );

        elizaLogger.success("[Scheduler] AuraLens autonomous scheduler started");
    }

    private async runCycle(): Promise<void> {
        if (!this.runtime) return;

        elizaLogger.info("[Scheduler] Triggering autonomous trade cycle");

        try {
            const agentId = this.runtime.agentId;
            const roomId = stringToUuid("auralens-autonomous-room");
            const userId = stringToUuid("auralens-scheduler");

            const message = {
                id: stringToUuid(`cycle-${Date.now()}`),
                agentId,
                userId,
                roomId,
                content: {
                    text: "Run autonomous trade cycle",
                    source: "scheduler",
                },
                createdAt: Date.now(),
            };

            await tradeCycleAction.handler(
                this.runtime,
                message,
                null as any,
                {},
                (response) => {
                    elizaLogger.info(`[Scheduler] Cycle update: ${response.text}`);
                }
            );
        } catch (err) {
            elizaLogger.error("[Scheduler] Cycle error:", err);
        }
    }

    async stop(): Promise<void> {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
        elizaLogger.info("[Scheduler] AuraLens scheduler stopped");
    }
}

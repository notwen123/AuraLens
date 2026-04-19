/**
 * Risk & Compliance Engine
 * Enforces spending caps, timelocks, confidence thresholds, and position limits.
 * This is the "Compliance Agent" layer — no trade executes without passing here.
 */

import { IAgentRuntime, elizaLogger } from "@elizaos/core";
import type { RiskCheckResult, TradeSignal, TreasuryState } from "../types.js";

// Defaults (all overridable via env)
const DEFAULTS = {
    MIN_CONFIDENCE: 0.55,          // minimum consensus confidence to trade
    MAX_TRADE_PCT: 0.01,           // max 1% of treasury per trade
    MAX_LEVERAGE: 10,              // hard cap on leverage
    MIN_AGREEMENT_SCORE: 0.5,      // models must agree at least 50%
    TIMELOCK_MS: 30_000,           // 30s minimum between trades
    MAX_OPEN_POSITIONS: 3,         // max concurrent positions
    MAX_DAILY_LOSS_PCT: 0.05,      // stop trading if daily loss > 5%
};

// In-memory state (persisted to Unibase in production)
const state = {
    lastTradeAt: 0,
    openPositionCount: 0,
    dailyPnlUsd: 0,
    dailyResetAt: startOfDay(),
};

function startOfDay(): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function resetDailyIfNeeded(): void {
    if (Date.now() > state.dailyResetAt + 86_400_000) {
        state.dailyPnlUsd = 0;
        state.dailyResetAt = startOfDay();
    }
}

export function recordTradeResult(pnlUsd: number): void {
    resetDailyIfNeeded();
    state.dailyPnlUsd += pnlUsd;
}

export function recordPositionOpened(): void {
    state.openPositionCount++;
    state.lastTradeAt = Date.now();
}

export function recordPositionClosed(): void {
    state.openPositionCount = Math.max(0, state.openPositionCount - 1);
}

export async function runRiskCheck(
    runtime: IAgentRuntime,
    signal: TradeSignal,
    agreementScore: number,
    treasury: TreasuryState
): Promise<RiskCheckResult> {
    resetDailyIfNeeded();

    const minConfidence = Number(
        runtime.getSetting("RISK_MIN_CONFIDENCE") ?? DEFAULTS.MIN_CONFIDENCE
    );
    const maxTradePct = Number(
        runtime.getSetting("RISK_MAX_TRADE_PCT") ?? DEFAULTS.MAX_TRADE_PCT
    );
    const timelockMs = Number(
        runtime.getSetting("RISK_TIMELOCK_MS") ?? DEFAULTS.TIMELOCK_MS
    );
    const maxPositions = Number(
        runtime.getSetting("RISK_MAX_OPEN_POSITIONS") ?? DEFAULTS.MAX_OPEN_POSITIONS
    );
    const maxDailyLossPct = Number(
        runtime.getSetting("RISK_MAX_DAILY_LOSS_PCT") ?? DEFAULTS.MAX_DAILY_LOSS_PCT
    );
    const minAgreement = Number(
        runtime.getSetting("RISK_MIN_AGREEMENT_SCORE") ?? DEFAULTS.MIN_AGREEMENT_SCORE
    );

    // ── Check 1: Confidence threshold ────────────────────────────────────────
    if (signal.confidence < minConfidence) {
        return deny(
            `Confidence ${signal.confidence.toFixed(2)} below minimum ${minConfidence}`,
            0
        );
    }

    // ── Check 2: Model agreement ──────────────────────────────────────────────
    if (agreementScore < minAgreement) {
        return deny(
            `Model agreement ${agreementScore.toFixed(2)} below minimum ${minAgreement}`,
            0
        );
    }

    // ── Check 3: Timelock ─────────────────────────────────────────────────────
    const timeSinceLast = Date.now() - state.lastTradeAt;
    if (state.lastTradeAt > 0 && timeSinceLast < timelockMs) {
        return deny(
            `Timelock active: ${((timelockMs - timeSinceLast) / 1000).toFixed(0)}s remaining`,
            0
        );
    }

    // ── Check 4: Max open positions ───────────────────────────────────────────
    if (state.openPositionCount >= maxPositions) {
        return deny(
            `Max open positions reached (${state.openPositionCount}/${maxPositions})`,
            0
        );
    }

    // ── Check 5: Daily loss circuit breaker ───────────────────────────────────
    const dailyLossPct =
        treasury.totalUsd > 0
            ? Math.abs(Math.min(0, state.dailyPnlUsd)) / treasury.totalUsd
            : 0;
    if (dailyLossPct >= maxDailyLossPct) {
        return deny(
            `Daily loss circuit breaker: ${(dailyLossPct * 100).toFixed(2)}% >= ${(maxDailyLossPct * 100).toFixed(0)}%`,
            0
        );
    }

    // ── Check 6: Treasury minimum ─────────────────────────────────────────────
    if (treasury.totalUsd < 100) {
        return deny("Treasury below minimum $100 threshold", 0);
    }

    // ── Compute capped trade size ─────────────────────────────────────────────
    const rawSizeUsd = treasury.totalUsd * maxTradePct;
    // Scale by confidence: higher confidence → closer to max size
    const cappedSizeUsd = rawSizeUsd * signal.confidence;

    elizaLogger.info(
        `[Risk] APPROVED: ${signal.pair} ${signal.direction}, size=$${cappedSizeUsd.toFixed(2)}, confidence=${signal.confidence.toFixed(2)}`
    );

    return {
        approved: true,
        reason: "All risk checks passed",
        cappedSizeUsd,
    };
}

function deny(reason: string, cappedSizeUsd: number): RiskCheckResult {
    elizaLogger.warn(`[Risk] DENIED: ${reason}`);
    return { approved: false, reason, cappedSizeUsd };
}

// ─── AuraLens Core Types ────────────────────────────────────────────────────

export interface TradeSignal {
    pair: string;           // e.g. "BTC/USDT"
    direction: "long" | "short";
    confidence: number;     // 0-1
    reasoning: string;
    technicalScore: number;
    sentimentScore: number;
    memeScore: number;      // Four.meme cultural signal
    timestamp: number;
}

export interface RiskCheckResult {
    approved: boolean;
    reason: string;
    cappedSizeUsd: number;  // enforced max 1% of treasury
    timelockExpiry?: number;
}

export interface MYXPosition {
    positionId: string;
    pair: string;
    direction: "long" | "short";
    sizeUsd: number;
    entryPrice: number;
    leverage: number;
    openedAt: number;
    txHash: string;
}

export interface MYXTradeResult {
    success: boolean;
    txHash?: string;
    positionId?: string;
    error?: string;
    pnlUsd?: number;
    isProfit?: boolean;
}

export interface ProfitSharingInvoice {
    invoiceId: string;
    tradeId: string;
    grossPnlUsd: number;
    performanceFeeUsd: number;   // 5% of gross PnL
    netPnlUsd: number;
    buybackAmountUsd: number;    // = performanceFeeUsd
    txHash: string;              // Pieverse x402b receipt tx
    issuedAt: number;
    onChainProof: string;
}

export interface DGridConsensusResult {
    finalDecision: TradeSignal;
    analystSignal: TradeSignal;   // Llama 3 — technical analysis
    sentimentSignal: TradeSignal; // GPT-4 — sentiment + meme
    agreementScore: number;       // 0-1, how much models agree
    modelLogs: ModelCallLog[];
}

export interface ModelCallLog {
    model: string;
    provider: string;
    prompt: string;
    response: string;
    latencyMs: number;
    timestamp: number;
}

export interface FourMemeSignal {
    tokenSymbol: string;
    launchTimestamp: number;
    initialLiquidityUsd: number;
    socialMentions: number;
    sentimentScore: number;   // -1 to 1
    trendingRank: number;
}

export interface TreasuryState {
    totalUsd: number;
    auraTokenAddress: string;
    auraPrice: number;
    auraMarketCapUsd: number;
    lastBuybackTxHash?: string;
    lastBuybackAmountUsd?: number;
    lastBuybackAt?: number;
    performanceFeeAccruedUsd: number;
}

export interface AuraLensConfig {
    // BNB Chain
    bnbRpcUrl: string;
    privateKey: string;
    walletAddress: string;

    // MYX V2
    myxRouterAddress: string;
    myxVaultAddress: string;
    maxLeverageX: number;         // default 10x
    maxTradeSizePct: number;      // default 0.01 (1%)

    // Four.meme
    fourMemeApiUrl: string;
    auraTokenAddress: string;

    // Pieverse
    pierverseApiUrl: string;
    pierverseApiKey: string;
    pierverseSkillId: string;

    // DGrid
    dgridApiUrl: string;
    dgridApiKey: string;

    // Unibase
    unibaseApiUrl: string;
    unibaseApiKey: string;

    // Performance fee
    performanceFeePct: number;    // default 0.05 (5%)
}

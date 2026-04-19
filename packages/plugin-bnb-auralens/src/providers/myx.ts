/**
 * MYX V2 Perpetuals Provider
 * Handles position opening/closing and liquidity depth adjustment.
 * Supports both BSC Testnet (dev) and BSC Mainnet (prod) via BNB_NETWORK env.
 */

import { IAgentRuntime, elizaLogger } from "@elizaos/core";
import {
    createWalletClient,
    createPublicClient,
    http,
    parseUnits,
    formatUnits,
    type Hex,
    type Address,
    defineChain,
} from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { MYXPosition, MYXTradeResult, TradeSignal } from "../types.js";

// ── Network helpers ───────────────────────────────────────────────────────────

function getChain(runtime: IAgentRuntime) {
    const network = runtime.getSetting("BNB_NETWORK") ?? "testnet";
    return network === "mainnet" ? bsc : bscTestnet;
}

function getDefaultRpc(runtime: IAgentRuntime) {
    const network = runtime.getSetting("BNB_NETWORK") ?? "testnet";
    return network === "mainnet"
        ? "https://bsc-dataseed.binance.org"
        : "https://data-seed-prebsc-1-s1.binance.org:8545";
}

// MYX V2 contract ABIs (minimal — only what we need)
const MYX_ROUTER_ABI = [
    {
        name: "openPosition",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            { name: "pair", type: "bytes32" },
            { name: "isLong", type: "bool" },
            { name: "collateralDelta", type: "uint256" },
            { name: "sizeDelta", type: "uint256" },
            { name: "acceptablePrice", type: "uint256" },
        ],
        outputs: [{ name: "positionId", type: "bytes32" }],
    },
    {
        name: "closePosition",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            { name: "positionId", type: "bytes32" },
            { name: "sizeDelta", type: "uint256" },
            { name: "acceptablePrice", type: "uint256" },
        ],
        outputs: [{ name: "pnl", type: "int256" }],
    },
    {
        name: "getPosition",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "positionId", type: "bytes32" }],
        outputs: [
            { name: "pair", type: "bytes32" },
            { name: "isLong", type: "bool" },
            { name: "size", type: "uint256" },
            { name: "collateral", type: "uint256" },
            { name: "entryPrice", type: "uint256" },
            { name: "unrealizedPnl", type: "int256" },
        ],
    },
    {
        name: "adjustLiquidityDepth",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            { name: "pair", type: "bytes32" },
            { name: "depthBps", type: "uint256" }, // basis points
        ],
        outputs: [],
    },
] as const;

const PRICE_FEED_ABI = [
    {
        name: "getPrice",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "pair", type: "bytes32" }],
        outputs: [{ name: "price", type: "uint256" }],
    },
] as const;

function getClients(runtime: IAgentRuntime) {
    const rpcUrl =
        runtime.getSetting("BNB_RPC_URL") ?? getDefaultRpc(runtime);
    const privateKey = runtime.getSetting("BNB_PRIVATE_KEY") as Hex;

    if (!privateKey) throw new Error("BNB_PRIVATE_KEY not set");

    const account = privateKeyToAccount(privateKey);
    const chain = getChain(runtime);

    const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
    });

    const walletClient = createWalletClient({
        account,
        chain,
        transport: http(rpcUrl),
    });

    return { publicClient, walletClient, account };
}

function pairToBytes32(pair: string): Hex {
    // Convert "BTC/USDT" → bytes32 keccak-style identifier
    const encoder = new TextEncoder();
    const bytes = encoder.encode(pair.replace("/", "_").toUpperCase());
    const padded = new Uint8Array(32);
    padded.set(bytes.slice(0, 32));
    return `0x${Buffer.from(padded).toString("hex")}` as Hex;
}

export async function getCurrentPrice(
    runtime: IAgentRuntime,
    pair: string
): Promise<number> {
    try {
        const { publicClient } = getClients(runtime);
        const priceFeedAddress = runtime.getSetting(
            "MYX_PRICE_FEED_ADDRESS"
        ) as Address;

        if (!priceFeedAddress) {
            elizaLogger.warn("[MYX] MYX_PRICE_FEED_ADDRESS not set, using mock price");
            return getMockPrice(pair);
        }

        const price = await publicClient.readContract({
            address: priceFeedAddress,
            abi: PRICE_FEED_ABI,
            functionName: "getPrice",
            args: [pairToBytes32(pair)],
        });

        return Number(formatUnits(price as bigint, 8));
    } catch (err) {
        elizaLogger.error("[MYX] Failed to get price:", err);
        return getMockPrice(pair);
    }
}

export async function openMYXPosition(
    runtime: IAgentRuntime,
    signal: TradeSignal,
    sizeUsd: number
): Promise<MYXTradeResult> {
    const routerAddress = runtime.getSetting("MYX_ROUTER_ADDRESS") as Address;
    if (!routerAddress) throw new Error("MYX_ROUTER_ADDRESS not set");

    try {
        const { publicClient, walletClient, account } = getClients(runtime);

        const currentPrice = await getCurrentPrice(runtime, signal.pair);
        // 0.5% slippage tolerance
        const slippageBps = 50n;
        const acceptablePrice =
            signal.direction === "long"
                ? parseUnits(
                      (currentPrice * 1.005).toFixed(8),
                      8
                  )
                : parseUnits(
                      (currentPrice * 0.995).toFixed(8),
                      8
                  );

        // collateral = sizeUsd / leverage (default 5x)
        const leverage = Number(runtime.getSetting("MYX_DEFAULT_LEVERAGE") ?? "5");
        const collateralUsd = sizeUsd / leverage;

        elizaLogger.info(
            `[MYX] Opening ${signal.direction} on ${signal.pair}: size=$${sizeUsd}, collateral=$${collateralUsd}, leverage=${leverage}x`
        );

        const { request } = await publicClient.simulateContract({
            address: routerAddress,
            abi: MYX_ROUTER_ABI,
            functionName: "openPosition",
            args: [
                pairToBytes32(signal.pair),
                signal.direction === "long",
                parseUnits(collateralUsd.toFixed(6), 6),
                parseUnits(sizeUsd.toFixed(6), 6),
                acceptablePrice,
            ],
            account: account.address,
        });

        const txHash = await walletClient.writeContract(request);

        elizaLogger.success(`[MYX] Position opened: ${txHash}`);

        // Wait for receipt to get positionId from logs
        const receipt = await publicClient.waitForTransactionReceipt({
            hash: txHash,
        });

        const positionId =
            receipt.logs?.[0]?.topics?.[1] ?? `0x${Date.now().toString(16)}`;

        return {
            success: true,
            txHash,
            positionId,
        };
    } catch (err: any) {
        elizaLogger.error("[MYX] Failed to open position:", err);
        return { success: false, error: err.message };
    }
}

export async function closeMYXPosition(
    runtime: IAgentRuntime,
    position: MYXPosition
): Promise<MYXTradeResult> {
    const routerAddress = runtime.getSetting("MYX_ROUTER_ADDRESS") as Address;
    if (!routerAddress) throw new Error("MYX_ROUTER_ADDRESS not set");

    try {
        const { publicClient, walletClient, account } = getClients(runtime);

        const currentPrice = await getCurrentPrice(runtime, position.pair);
        const acceptablePrice =
            position.direction === "long"
                ? parseUnits((currentPrice * 0.995).toFixed(8), 8)
                : parseUnits((currentPrice * 1.005).toFixed(8), 8);

        elizaLogger.info(
            `[MYX] Closing position ${position.positionId} on ${position.pair}`
        );

        const { request } = await publicClient.simulateContract({
            address: routerAddress,
            abi: MYX_ROUTER_ABI,
            functionName: "closePosition",
            args: [
                position.positionId as Hex,
                parseUnits(position.sizeUsd.toFixed(6), 6),
                acceptablePrice,
            ],
            account: account.address,
        });

        const txHash = await walletClient.writeContract(request);
        const receipt = await publicClient.waitForTransactionReceipt({
            hash: txHash,
        });

        // Parse PnL from return value / events
        const pnlRaw = receipt.logs?.[0]?.data ?? "0x0";
        const pnlUsd = Number(formatUnits(BigInt(pnlRaw), 6));

        elizaLogger.success(
            `[MYX] Position closed: ${txHash}, PnL=$${pnlUsd.toFixed(2)}`
        );

        return {
            success: true,
            txHash,
            pnlUsd,
            isProfit: pnlUsd > 0,
        };
    } catch (err: any) {
        elizaLogger.error("[MYX] Failed to close position:", err);
        return { success: false, error: err.message };
    }
}

export async function adjustLiquidityDepth(
    runtime: IAgentRuntime,
    pair: string,
    sentimentScore: number
): Promise<void> {
    const routerAddress = runtime.getSetting("MYX_ROUTER_ADDRESS") as Address;
    if (!routerAddress) return;

    try {
        const { publicClient, walletClient, account } = getClients(runtime);

        // Map sentiment (-1 to 1) → depth bps (5000 to 15000 = 50% to 150%)
        const depthBps = BigInt(
            Math.round(10000 + sentimentScore * 5000)
        );

        elizaLogger.info(
            `[MYX] Adjusting liquidity depth for ${pair}: ${depthBps}bps (sentiment=${sentimentScore.toFixed(2)})`
        );

        const { request } = await publicClient.simulateContract({
            address: routerAddress,
            abi: MYX_ROUTER_ABI,
            functionName: "adjustLiquidityDepth",
            args: [pairToBytes32(pair), depthBps],
            account: account.address,
        });

        await walletClient.writeContract(request);
    } catch (err) {
        elizaLogger.error("[MYX] Failed to adjust liquidity depth:", err);
    }
}

// ── Mock prices for dev/demo ──────────────────────────────────────────────────
function getMockPrice(pair: string): number {
    const prices: Record<string, number> = {
        "BTC/USDT": 67000,
        "ETH/USDT": 3500,
        "BNB/USDT": 580,
        "SOL/USDT": 175,
    };
    return prices[pair] ?? 100;
}

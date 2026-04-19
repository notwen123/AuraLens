/**
 * Treasury State Provider
 * Reads on-chain treasury balance, $AURA token price, and market cap from BNB Chain.
 */

import { IAgentRuntime, elizaLogger } from "@elizaos/core";
import {
    createPublicClient,
    http,
    formatUnits,
    type Address,
} from "viem";
import { bsc } from "viem/chains";
import NodeCache from "node-cache";
import type { TreasuryState } from "../types.js";

const cache = new NodeCache({ stdTTL: 30 }); // 30s cache

const ERC20_ABI = [
    {
        name: "balanceOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        name: "decimals",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint8" }],
    },
] as const;

// USDT on BNB Chain
const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955" as Address;

export async function getTreasuryState(
    runtime: IAgentRuntime
): Promise<TreasuryState> {
    const cacheKey = "treasury_state";
    const cached = cache.get<TreasuryState>(cacheKey);
    if (cached) return cached;

    const rpcUrl =
        runtime.getSetting("BNB_RPC_URL") ?? "https://bsc-dataseed.binance.org";
    const walletAddress = runtime.getSetting("BNB_WALLET_ADDRESS") as Address;
    const auraAddress = runtime.getSetting("AURA_TOKEN_ADDRESS") as Address;

    if (!walletAddress) {
        elizaLogger.warn("[Treasury] BNB_WALLET_ADDRESS not set, returning mock state");
        return getMockTreasury(auraAddress);
    }

    try {
        const publicClient = createPublicClient({
            chain: bsc,
            transport: http(rpcUrl),
        });

        // Get USDT balance (primary treasury asset)
        const usdtBalance = await publicClient.readContract({
            address: USDT_ADDRESS,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [walletAddress],
        });

        const totalUsd = Number(formatUnits(usdtBalance as bigint, 18));

        // Get $AURA price from PancakeSwap if address is set
        let auraPrice = 0;
        let auraMarketCapUsd = 0;

        if (auraAddress) {
            try {
                const priceRes = await fetch(
                    `https://api.dexscreener.com/latest/dex/tokens/${auraAddress}`
                );
                const priceData = await priceRes.json();
                const pair = priceData?.pairs?.[0];
                if (pair) {
                    auraPrice = Number(pair.priceUsd ?? 0);
                    auraMarketCapUsd = Number(pair.marketCap ?? 0);
                }
            } catch {
                elizaLogger.warn("[Treasury] Failed to fetch $AURA price");
            }
        }

        const state: TreasuryState = {
            totalUsd,
            auraTokenAddress: auraAddress ?? "",
            auraPrice,
            auraMarketCapUsd,
            performanceFeeAccruedUsd: 0,
        };

        cache.set(cacheKey, state);
        return state;
    } catch (err) {
        elizaLogger.error("[Treasury] Failed to fetch treasury state:", err);
        return getMockTreasury(auraAddress);
    }
}

function getMockTreasury(auraAddress?: string): TreasuryState {
    return {
        totalUsd: 10000,
        auraTokenAddress: auraAddress ?? "",
        auraPrice: 0.001,
        auraMarketCapUsd: 100000,
        performanceFeeAccruedUsd: 0,
    };
}

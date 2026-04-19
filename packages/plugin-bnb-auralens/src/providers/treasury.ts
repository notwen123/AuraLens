/**
 * Treasury State Provider
 * Reads on-chain treasury balance, $AURA token price, and market cap.
 * Supports BSC Testnet (dev) and BSC Mainnet (prod) via BNB_NETWORK env.
 */

import { IAgentRuntime, elizaLogger } from "@elizaos/core";
import {
    createPublicClient,
    http,
    formatUnits,
    type Address,
} from "viem";
import { bsc, bscTestnet } from "viem/chains";
import NodeCache from "node-cache";
import type { TreasuryState } from "../types.js";

const cache = new NodeCache({ stdTTL: 30 });

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

// ── Network-aware addresses ───────────────────────────────────────────────────
// Testnet: we deploy a mock USDT (see scripts/deployMockTokens.ts)
// Mainnet: real BSC-USD (Binance-Peg USDT)
const NETWORK_CONFIG = {
    mainnet: {
        rpc: "https://bsc-dataseed.binance.org",
        usdtAddress: "0x55d398326f99059fF775485246999027B3197955" as Address,
        explorerUrl: "https://bscscan.com",
    },
    testnet: {
        rpc: "https://data-seed-prebsc-1-s1.binance.org:8545",
        usdtAddress: "" as Address, // set via TESTNET_USDT_ADDRESS env after deploy
        explorerUrl: "https://testnet.bscscan.com",
    },
} as const;

export async function getTreasuryState(
    runtime: IAgentRuntime
): Promise<TreasuryState> {
    const cacheKey = "treasury_state";
    const cached = cache.get<TreasuryState>(cacheKey);
    if (cached) return cached;

    const network = (runtime.getSetting("BNB_NETWORK") ?? "testnet") as "mainnet" | "testnet";
    const netCfg = NETWORK_CONFIG[network];

    const rpcUrl = runtime.getSetting("BNB_RPC_URL") ?? netCfg.rpc;
    const walletAddress = runtime.getSetting("BNB_WALLET_ADDRESS") as Address;
    const auraAddress = runtime.getSetting("AURA_TOKEN_ADDRESS") as Address;

    // Resolve USDT address: env override → network default
    const usdtAddress = (
        runtime.getSetting("TESTNET_USDT_ADDRESS") ??
        runtime.getSetting("USDT_ADDRESS") ??
        netCfg.usdtAddress
    ) as Address;

    if (!walletAddress) {
        elizaLogger.warn("[Treasury] BNB_WALLET_ADDRESS not set, returning mock state");
        return getMockTreasury(auraAddress, network);
    }

    if (!usdtAddress) {
        elizaLogger.warn("[Treasury] No USDT address configured — deploy mock tokens first (pnpm run deploy:testnet)");
        return getMockTreasury(auraAddress, network);
    }

    try {
        const chain = network === "mainnet" ? bsc : bscTestnet;
        const publicClient = createPublicClient({
            chain,
            transport: http(rpcUrl),
        });

        const usdtBalance = await publicClient.readContract({
            address: usdtAddress,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [walletAddress],
        });

        // Testnet mock USDT uses 18 decimals; mainnet BSC-USD uses 18 too
        const totalUsd = Number(formatUnits(usdtBalance as bigint, 18));

        // $AURA price: on testnet use mock price since DexScreener won't have it
        let auraPrice = 0;
        let auraMarketCapUsd = 0;

        if (auraAddress && network === "mainnet") {
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
        } else if (auraAddress && network === "testnet") {
            // Mock price for testnet demo
            auraPrice = 0.001;
            auraMarketCapUsd = totalUsd * 10; // mock 10x treasury
        }

        const state: TreasuryState = {
            totalUsd,
            auraTokenAddress: auraAddress ?? "",
            auraPrice,
            auraMarketCapUsd,
            performanceFeeAccruedUsd: 0,
        };

        cache.set(cacheKey, state);
        elizaLogger.info(
            `[Treasury] ${network} — balance: $${totalUsd.toFixed(2)}, AURA: $${auraPrice}`
        );
        return state;
    } catch (err) {
        elizaLogger.error("[Treasury] Failed to fetch treasury state:", err);
        return getMockTreasury(auraAddress, network);
    }
}

function getMockTreasury(auraAddress?: string, network = "testnet"): TreasuryState {
    return {
        totalUsd: network === "testnet" ? 10000 : 0, // testnet gets mock $10k
        auraTokenAddress: auraAddress ?? "",
        auraPrice: 0.001,
        auraMarketCapUsd: 100000,
        performanceFeeAccruedUsd: 0,
    };
}

export function getExplorerUrl(runtime: IAgentRuntime, txHash: string): string {
    const network = (runtime.getSetting("BNB_NETWORK") ?? "testnet") as "mainnet" | "testnet";
    return `${NETWORK_CONFIG[network].explorerUrl}/tx/${txHash}`;
}

import { SolanaProvider } from "../utils/providers";
import { poolEvaluator } from "../evaluators/poolEvaluator";
import { walletProvider } from "../providers/wallet.ts";
import { Connection } from "@solana/web3.js";
import { schedule } from "../utils/scheduler.ts";
import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@elizaos/core";

interface FarmingPool {
    id: string;
    name: string;
    apr: number;
    riskScore: number;
    liquidity: number;
}

export const discoverFarmingPools: Action = {
    name: "DISCOVER_FARMING_POOLS",
    description: "Fetch and display available liquidity pools and farming opportunities.",
    similes: ["FIND_POOLS", "DISCOVER_POOLS", "LIST_FARMING_POOLS"],

    validate: async (runtime: IAgentRuntime, message: Memory) => {
        console.log("Validating discoverFarmingPools action.");
        return true;
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        try {
            const cluster = process.env.CLUSTER || "https://api.mainnet-beta.solana.com";
            const connection = new Connection(cluster);


            const pools: FarmingPool[] = await SolanaProvider.getFarmingPools(connection);

            // Rank pools using the Evaluator
            const rankedPools = pools
                .map((pool) => ({ ...pool, rank: Evaluator.scorePool(pool) }))
                .sort((a, b) => b.rank - a.rank);


            const userPreferences = state.userPreferences || { minApr: 10, maxRiskScore: 3 };
            const filteredPools = rankedPools.filter(
                (pool) => pool.apr >= userPreferences.minApr && pool.riskScore <= userPreferences.maxRiskScore
            );


            const poolList = filteredPools
                .map((pool, index) => `${index + 1}. ${pool.name} - APR: ${pool.apr}%, Risk: ${pool.riskScore}`)
                .join("\n");

            const responseText = `Here are the farming pools based on your preferences:\n\n${poolList}`;
            callback?.({ text: responseText });


            schedule("24h", async () => {
                console.log("Periodic check: Fetching farming pools...");
                const updatedPools = await SolanaProvider.getFarmingPools(connection);

                // Proactive notifications for significant changes
                const newTopPool = updatedPools[0]; // Example: Notify about the top-ranked pool
                if (newTopPool.apr > userPreferences.minApr) {
                    console.log("Notifying user about a new high-APR pool...");
                    const notification = {
                        text: `A new high-APR pool is available: ${newTopPool.name} with APR: ${newTopPool.apr}%`,
                    };
                    callback?.(notification);
                }
            });

            return true;
        } catch (error) {
            console.error("Error in discoverFarmingPools handler:", error);
            callback?.({ text: "Failed to fetch farming pools. Please try again later." });
            return false;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: "Find the best farming pools for me." },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Here are the farming pools based on your preferences:\n1. SOL/USDC - APR: 20%, Risk: 3\n2. BTC/ETH - APR: 15%, Risk: 2",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "Show me low-risk farming pools only." },
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Here are the low-risk farming pools:\n1. USDC/USDT - APR: 8%, Risk: 1\n2. BTC/ETH - APR: 10%, Risk: 2",
                },
            },
        ],
    ],
};

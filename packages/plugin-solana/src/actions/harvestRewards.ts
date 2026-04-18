import { walletProvider } from "../providers/wallet.ts";
import { schedule } from "../utils/scheduler.ts";
import { poolEvaluator } from "../evaluators/poolEvaluator.ts";
import { Connection, Transaction } from "@solana/web3.js";
import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@elizaos/core";

export const harvestRewards: Action = {
    name: "HARVEST_REWARDS",
    description: "Automatically harvest rewards from farming pools.",
    similes: ["COLLECT_REWARDS", "CLAIM_EARNINGS", "HARVEST_TOKENS"],

    validate: async (runtime: IAgentRuntime, message: Memory) => {
        console.log("Validating harvestRewards action.");
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

    e
            const poolId = message.poolId || state.poolId;
            if (!poolId) {
                callback?.({ text: "Missing required input: pool ID." });
                return false;
            }


            const poolDetails = await poolEvaluator.getPoolDetails(poolId);
            if (!poolDetails || !poolDetails.eligibleForHarvest) {
                callback?.({ text: `No rewards available for pool ${poolId}.` });
                return false;
            }


            const transaction = new Transaction();


            transaction.add(
                await poolEvaluator.createHarvestInstruction(
                    poolId,
                    walletProvider.publicKey
                )
            );


            const signedTransaction = await walletProvider.signTransaction(transaction);
            const txId = await connection.sendRawTransaction(signedTransaction.serialize());


            await connection.confirmTransaction(txId, "confirmed");

            callback?.({ text: `Successfully harvested rewards from pool ${poolId}. Transaction ID: ${txId}` });
            return true;
        } catch (error) {
            console.error("Error in harvestRewards handler:", error);
            callback?.({ text: "Failed to harvest rewards. Please try again later." });
            return false;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Harvest rewards from the SOL/USDC pool."
                }
            },
            {
                user: "him",
                content: {
                    text: "Successfully harvested rewards from the SOL/USDC pool. Transaction ID: ..."
                }
            }
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Collect earnings from my BTC/ETH farming pool."
                }
            },
            {
                user: "him",
                content: {
                    text: "Successfully harvested rewards from the BTC/ETH pool. Transaction ID: ..."
                }
            }
        ]
    ]
};

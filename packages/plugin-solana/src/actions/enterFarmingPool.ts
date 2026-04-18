import { SolanaProvider } from "../utils/providers";
import { walletProvider } from "../providers/wallet";
import { Connection, Transaction } from "@solana/web3.js";
import type { Action, IAgentRuntime, Memory, State, HandlerCallback } from "@elizaos/core";

interface EnterFarmingPoolInput {
    poolId: string;
    tokenPair: string;
    amount: number;
}

export const enterFarmingPool: Action = {
    name: "ENTER_FARMING_POOL",
    description: "Add liquidity to a farming pool or stake LP tokens.",
    similes: ["JOIN_POOL", "STAKE_TOKENS", "ADD_LIQUIDITY"],

    validate: async (runtime: IAgentRuntime, message: Memory) => {
        console.log("Validating enterFarmingPool action.");
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


            const input: EnterFarmingPoolInput = {
                poolId: message.poolId || state.poolId,
                tokenPair: message.tokenPair || state.tokenPair,
                amount: message.amount || state.amount,
            };

            if (!input.poolId || !input.tokenPair || !input.amount) {
                callback?.({ text: "Missing required inputs: pool ID, token pair, or amount." });
                return false;
            }


            const poolDetails = await SolanaProvider.getPoolDetails(input.poolId);
            if (!poolDetails) {
                callback?.({ text: `Pool with ID ${input.poolId} not found.` });
                return false;
            }


            const transaction = new Transaction();


            transaction.add(
                await SolanaProvider.createLiquidityInstruction(
                    input.poolId,
                    input.tokenPair,
                    input.amount,
                    walletProvider.publicKey
                )
            );


            const signedTransaction = await walletProvider.signTransaction(transaction);
            const txId = await connection.sendRawTransaction(signedTransaction.serialize());


            await connection.confirmTransaction(txId, "confirmed");


            callback?.({ text: `Successfully added liquidity to pool ${input.poolId}. Transaction ID: ${txId}` });
            return true;
        } catch (error) {
            console.error("Error in enterFarmingPool handler:", error);
            callback?.({ text: "Failed to add liquidity to the farming pool. Please try again later." });
            return false;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Join the SOL/USDC farming pool with 100 tokens."
                }
            },
            {
                user: "him",
                content: {
                    text: "Successfully added liquidity to the SOL/USDC pool. Transaction ID: ..."
                }
            }
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Stake 50 USDC in the BTC/USDC pool."
                }
            },
            {
                user: "him",
                content: {
                    text: "Successfully staked 50 USDC in the BTC/USDC pool. Transaction ID: ..."
                }
            }
        ]
    ]
};

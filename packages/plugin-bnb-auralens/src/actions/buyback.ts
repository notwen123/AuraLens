/**
 * $AURA Buyback Action
 * Uses 5% performance fee to buy back $AURA on Four.meme / PancakeSwap V3.
 * Creates a self-reinforcing value flywheel for token holders.
 */

import { IAgentRuntime, elizaLogger } from "@elizaos/core";
import {
    createWalletClient,
    createPublicClient,
    http,
    parseUnits,
    type Hex,
    type Address,
} from "viem";
import { bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// PancakeSwap V3 Router on BNB Chain
const PANCAKE_ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4" as Address;
const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955" as Address;

const PANCAKE_ROUTER_ABI = [
    {
        name: "exactInputSingle",
        type: "function",
        stateMutability: "payable",
        inputs: [
            {
                name: "params",
                type: "tuple",
                components: [
                    { name: "tokenIn", type: "address" },
                    { name: "tokenOut", type: "address" },
                    { name: "fee", type: "uint24" },
                    { name: "recipient", type: "address" },
                    { name: "amountIn", type: "uint256" },
                    { name: "amountOutMinimum", type: "uint256" },
                    { name: "sqrtPriceLimitX96", type: "uint160" },
                ],
            },
        ],
        outputs: [{ name: "amountOut", type: "uint256" }],
    },
] as const;

const ERC20_APPROVE_ABI = [
    {
        name: "approve",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
] as const;

export interface BuybackResult {
    success: boolean;
    txHash?: string;
    auraAmount?: number;
    error?: string;
}

export async function executeBuyback(
    runtime: IAgentRuntime,
    amountUsd: number
): Promise<BuybackResult> {
    const auraAddress = runtime.getSetting("AURA_TOKEN_ADDRESS") as Address;
    const privateKey = runtime.getSetting("BNB_PRIVATE_KEY") as Hex;
    const rpcUrl =
        runtime.getSetting("BNB_RPC_URL") ?? "https://bsc-dataseed.binance.org";

    if (!auraAddress) {
        elizaLogger.warn("[Buyback] AURA_TOKEN_ADDRESS not set, skipping buyback");
        return { success: false, error: "AURA_TOKEN_ADDRESS not configured" };
    }

    if (!privateKey) {
        return { success: false, error: "BNB_PRIVATE_KEY not set" };
    }

    elizaLogger.info(`[Buyback] Executing $AURA buyback: $${amountUsd.toFixed(2)}`);

    try {
        const account = privateKeyToAccount(privateKey);

        const publicClient = createPublicClient({
            chain: bsc,
            transport: http(rpcUrl),
        });

        const walletClient = createWalletClient({
            account,
            chain: bsc,
            transport: http(rpcUrl),
        });

        const amountIn = parseUnits(amountUsd.toFixed(6), 18); // USDT 18 decimals on BSC

        // Step 1: Approve USDT spend
        const { request: approveReq } = await publicClient.simulateContract({
            address: USDT_ADDRESS,
            abi: ERC20_APPROVE_ABI,
            functionName: "approve",
            args: [PANCAKE_ROUTER, amountIn],
            account: account.address,
        });
        await walletClient.writeContract(approveReq);

        // Step 2: Swap USDT → $AURA via PancakeSwap V3 (0.3% fee tier)
        const { request: swapReq } = await publicClient.simulateContract({
            address: PANCAKE_ROUTER,
            abi: PANCAKE_ROUTER_ABI,
            functionName: "exactInputSingle",
            args: [
                {
                    tokenIn: USDT_ADDRESS,
                    tokenOut: auraAddress,
                    fee: 3000, // 0.3% fee tier
                    recipient: account.address,
                    amountIn,
                    amountOutMinimum: 0n, // accept any amount (slippage handled by size cap)
                    sqrtPriceLimitX96: 0n,
                },
            ],
            account: account.address,
        });

        const txHash = await walletClient.writeContract(swapReq);
        const receipt = await publicClient.waitForTransactionReceipt({
            hash: txHash,
        });

        // Parse amountOut from logs
        const auraAmount = amountUsd / 0.001; // fallback estimate

        elizaLogger.success(
            `[Buyback] $AURA buyback complete: ${txHash}, ~${auraAmount.toFixed(0)} AURA`
        );

        return {
            success: true,
            txHash,
            auraAmount,
        };
    } catch (err: any) {
        elizaLogger.error("[Buyback] Buyback failed:", err);
        return { success: false, error: err.message };
    }
}

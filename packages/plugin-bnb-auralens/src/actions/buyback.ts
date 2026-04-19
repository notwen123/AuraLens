/**
 * $AURA Buyback Action
 * Swaps USDT → $AURA via PancakeSwap V3.
 * Testnet: PancakeSwap testnet router + mock tokens deployed by scripts/deployMockTokens.ts
 * Mainnet: real PancakeSwap V3 router + BSC-USD
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
import { bsc, bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// PancakeSwap V3 SmartRouter
const PANCAKE_ROUTER: Record<string, Address> = {
    mainnet: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
    testnet: "0x9a489505a00cE272eAa5e07Dba6491314CaE3796",
};

// BSC-USD (USDT)
const USDT_MAINNET = "0x55d398326f99059fF775485246999027B3197955" as Address;

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
    const network = (runtime.getSetting("BNB_NETWORK") ?? "testnet") as "mainnet" | "testnet";
    const rpcUrl =
        runtime.getSetting("BNB_RPC_URL") ??
        (network === "mainnet"
            ? "https://bsc-dataseed.binance.org"
            : "https://data-seed-prebsc-1-s1.binance.org:8545");

    if (!auraAddress) {
        elizaLogger.warn("[Buyback] AURA_TOKEN_ADDRESS not set, skipping");
        return { success: false, error: "AURA_TOKEN_ADDRESS not configured" };
    }
    if (!privateKey) {
        return { success: false, error: "BNB_PRIVATE_KEY not set" };
    }

    // Resolve USDT: testnet uses mock token deployed by deploy script
    const usdtAddress = (
        runtime.getSetting("TESTNET_USDT_ADDRESS") ?? USDT_MAINNET
    ) as Address;

    if (network === "testnet" && !runtime.getSetting("TESTNET_USDT_ADDRESS")) {
        elizaLogger.warn("[Buyback] TESTNET_USDT_ADDRESS not set — run: pnpm run deploy:testnet");
        return { success: false, error: "TESTNET_USDT_ADDRESS not set" };
    }

    elizaLogger.info(
        `[Buyback] ${network} — $AURA buyback: $${amountUsd.toFixed(2)}`
    );

    try {
        const account = privateKeyToAccount(privateKey);
        const chain = network === "mainnet" ? bsc : bscTestnet;
        const routerAddress = PANCAKE_ROUTER[network];

        const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
        const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

        const amountIn = parseUnits(amountUsd.toFixed(6), 18);

        // Approve USDT spend
        const { request: approveReq } = await publicClient.simulateContract({
            address: usdtAddress,
            abi: ERC20_APPROVE_ABI,
            functionName: "approve",
            args: [routerAddress, amountIn],
            account: account.address,
        });
        await walletClient.writeContract(approveReq);

        // Swap USDT → $AURA (0.3% fee tier)
        const { request: swapReq } = await publicClient.simulateContract({
            address: routerAddress,
            abi: PANCAKE_ROUTER_ABI,
            functionName: "exactInputSingle",
            args: [{
                tokenIn: usdtAddress,
                tokenOut: auraAddress,
                fee: 3000,
                recipient: account.address,
                amountIn,
                amountOutMinimum: 0n,
                sqrtPriceLimitX96: 0n,
            }],
            account: account.address,
        });

        const txHash = await walletClient.writeContract(swapReq);
        await publicClient.waitForTransactionReceipt({ hash: txHash });

        const auraAmount = amountUsd / 0.001; // mock price estimate
        elizaLogger.success(`[Buyback] Done: ${txHash}, ~${auraAmount.toFixed(0)} AURA`);

        return { success: true, txHash, auraAmount };
    } catch (err: any) {
        elizaLogger.error("[Buyback] Failed:", err);
        return { success: false, error: err.message };
    }
}

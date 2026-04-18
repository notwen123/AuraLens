
export { discoverFarmingPools } from "./actions/discoverFarmingPools";
export { enterFarmingPool } from "./actions/enterFarmingPool";
export { harvestRewards } from "./actions/harvestRewards.ts";
export { exitFarmingPool } from "./actions/exitFarmingPool.ts";
export { rebalanceFarmingPortfolio } from "./actions/rebalanceFarmingPortfolio.ts";
export { rebalanceYieldFarmingPortfolio } from "./actions/rebalanceYieldFarmingPortfolio";
export * from "./providers/token.ts";
export * from "./providers/wallet.ts";
export * from "./providers/trustScoreProvider.ts";
export * from "./evaluators/trust.ts";

import { Plugin } from "@elizaos/core";
import { executeSwap } from "./actions/swap.ts";
import take_order from "./actions/takeOrder";
import pumpfun from "./actions/pumpfun.ts";
import fomo from "./actions/fomo.ts";
import { executeSwapForDAO } from "./actions/swapDao";
import transferToken from "./actions/transfer.ts";
import { walletProvider } from "./providers/wallet.ts";
import { trustScoreProvider } from "./providers/trustScoreProvider.ts";
import { trustEvaluator } from "./evaluators/trust.ts";
import { TokenProvider } from "./providers/token.ts";
import { WalletProvider } from "./providers/wallet.ts";
import { PoolProvider } from "./providers/poolProvider";
import { PoolEvaluator } from "./evaluators/poolEvaluator";
import { schedule } from "./utils/scheduler";
import { SolanaUtils } from "./utils/solanaUtils";

export { TokenProvider, WalletProvider, PoolProvider, PoolEvaluator, schedule, SolanaUtils };

export const solanaPlugin: Plugin = {
    name: "solana",
    description: "Solana Plugin for Eliza",
    actions: [
        executeSwap,
        pumpfun,
        fomo,
        transferToken,
        executeSwapForDAO,
        take_order,
        discoverFarmingPools,
        enterFarmingPool,
        harvestRewards,
        exitFarmingPool,
        rebalanceFarmingPortfolio,
        rebalanceYieldFarmingPortfolio
    ],
    evaluators: [trustEvaluator, PoolEvaluator],
    providers: [walletProvider, trustScoreProvider, PoolProvider],
};

export default solanaPlugin;

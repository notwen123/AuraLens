export class PoolEvaluator {
    static scorePool(pool: { apr: number; riskScore: number; liquidity: number }): number {

        return (pool.apr / pool.riskScore) * Math.log(pool.liquidity + 1);
    }

    static filterPools(pools: any[], preferences: { minApr: number; maxRiskScore: number }): any[] {
        return pools.filter(
            (pool) => pool.apr >= preferences.minApr && pool.riskScore <= preferences.maxRiskScore
        );
    }
}

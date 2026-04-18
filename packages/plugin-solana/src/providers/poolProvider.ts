import { Connection } from "@solana/web3.js";

export class PoolProvider {
    private connection: Connection;

    constructor(clusterUrl: string) {
        this.connection = new Connection(clusterUrl);
    }

    async getFarmingPools(): Promise<any[]> {

        console.log("Fetching farming pools...");

        // Mock data example
        return [
            { id: "1", name: "SOL/USDC", apr: 20, riskScore: 3, liquidity: 100000 },
            { id: "2", name: "BTC/ETH", apr: 15, riskScore: 2, liquidity: 75000 },
            { id: "3", name: "USDC/USDT", apr: 8, riskScore: 1, liquidity: 500000 },
        ];
    }
}

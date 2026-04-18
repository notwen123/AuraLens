import { Connection, PublicKey, Transaction } from "@solana/web3.js";

export class SolanaUtils {
    private connection: Connection;

    constructor(clusterUrl: string) {
        this.connection = new Connection(clusterUrl);
    }

    async getBalance(publicKey: PublicKey): Promise<number> {
        try {
            const lamports = await this.connection.getBalance(publicKey);
            return lamports / 1e9;
        } catch (error) {
            console.error("Error fetching balance:", error);
            throw error;
        }
    }

    async sendTransaction(transaction: Transaction, signers: any[]): Promise<string> {
        try {
            const latestBlockhash = await this.connection.getLatestBlockhash();
            transaction.recentBlockhash = latestBlockhash.blockhash;
            transaction.feePayer = signers[0].publicKey;

            transaction.sign(...signers);

            const txid = await this.connection.sendRawTransaction(transaction.serialize(), {
                skipPreflight: false,
                maxRetries: 3,
                preflightCommitment: "confirmed",
            });

            await this.connection.confirmTransaction(txid, "confirmed");
            return txid;
        } catch (error) {
            console.error("Error sending transaction:", error);
            throw error;
        }
    }
}

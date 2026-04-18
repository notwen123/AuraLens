export function schedule(interval: string, task: () => Promise<void>) {
    const intervalMap: { [key: string]: number } = {
        "1h": 3600000,
        "24h": 86400000,
    };

    const ms = intervalMap[interval];
    if (!ms) {
        console.error("Invalid interval provided to scheduler:", interval);
        return;
    }

    setInterval(async () => {
        try {
            await task();
        } catch (error) {
            console.error("Scheduled task failed:", error);
        }
    }, ms);
}

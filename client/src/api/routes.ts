export const ROUTES = {
    sendMessage: (agentId: string): string => `/api/${agentId}/message`,
    getAgents: (): string => `/api/agents`,
    // AuraLens audit dashboard
    auditReport: (agentId: string): string => `/api/${agentId}/auralens/audit`,
    tradeCycle: (agentId: string): string => `/api/${agentId}/auralens/trade`,
    treasury: (agentId: string): string => `/api/${agentId}/auralens/treasury`,
    trades: (agentId: string): string => `/api/${agentId}/auralens/trades`,
};

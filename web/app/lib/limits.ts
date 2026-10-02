/** Allowed account sizes, shared by the page (account.ts) and the server (/api/account). */
export const BALANCE_LIMITS = [10, 10_000_000] as const;
export const RISK_LIMITS = [0.1, 10] as const;

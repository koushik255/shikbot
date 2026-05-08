import { withCodexRpc } from "./codex-rpc.js";

export type CodexAccount =
  | { type: "chatgpt"; email: string; planType: string }
  | { type: "apiKey" }
  | { type: "amazonBedrock" };

export type CodexRateLimitWindow = {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
};

export type CodexRateLimitSnapshot = {
  limitId: string | null;
  limitName: string | null;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
  planType: string | null;
  rateLimitReachedType: string | null;
};

type CodexAccountResponse = {
  account: CodexAccount | null;
  requiresOpenaiAuth: boolean;
};

type CodexRateLimitsResponse = {
  rateLimits: CodexRateLimitSnapshot;
  rateLimitsByLimitId: Record<string, CodexRateLimitSnapshot> | null;
};

export type CodexAccountUsage = {
  account: CodexAccountResponse;
  rateLimits: CodexRateLimitsResponse;
};

/**
 * Read the Codex account profile and rate-limit windows by talking to the
 * local `codex app-server` over JSON-RPC.
 */
export async function readCodexAccountUsage(timeoutMs?: number): Promise<CodexAccountUsage> {
  return withCodexRpc(
    async ({ request }) => {
      const [account, rateLimits] = await Promise.all([
        request<CodexAccountResponse>("account/read", { refreshToken: false }),
        request<CodexRateLimitsResponse>("account/rateLimits/read")
      ]);
      return { account, rateLimits };
    },
    timeoutMs !== undefined ? { timeoutMs } : {}
  );
}

export async function formatCodexAccountUsageReport(): Promise<string> {
  const { account, rateLimits } = await readCodexAccountUsage();
  const activeLimits = rateLimits.rateLimitsByLimitId?.["codex"] ?? rateLimits.rateLimits;

  return [
    "Codex account usage:",
    `Account: ${describeAccount(account.account)}`,
    `Limit: ${activeLimits.limitId ?? "unknown"}`,
    `Plan: ${activeLimits.planType ?? "unknown"}`,
    ...formatWindow("Primary limit", activeLimits.primary),
    ...formatWindow("Secondary limit", activeLimits.secondary),
    `Credits: ${describeCredits(activeLimits.credits)}`,
    `Limit reached: ${activeLimits.rateLimitReachedType ?? "no"}`
  ].join("\n");
}

function describeAccount(account: CodexAccount | null): string {
  if (!account) return "not logged in";
  switch (account.type) {
    case "chatgpt":
      return `${account.email} (${account.planType})`;
    case "apiKey":
      return "apiKey";
    case "amazonBedrock":
      return "amazonBedrock";
  }
}

function describeCredits(credits: CodexRateLimitSnapshot["credits"]): string {
  if (!credits) return "unavailable";
  if (credits.unlimited) return "unlimited";
  return credits.balance ?? "unknown";
}

function formatWindow(label: string, window: CodexRateLimitWindow | null): string[] {
  if (!window) return [`${label}: unavailable`];
  return [
    `${label}: ${window.usedPercent}% used`,
    `  Window: ${window.windowDurationMins ?? "unknown"} minutes`,
    `  Resets: ${formatReset(window.resetsAt)}`
  ];
}

function formatReset(epochSeconds: number | null): string {
  if (!epochSeconds) return "unknown";
  return new Date(epochSeconds * 1000).toLocaleString();
}

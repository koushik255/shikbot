import { spawn } from "node:child_process";

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

type JsonRpcMessage = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
};

type CodexAccountResponse = {
  account: CodexAccount | null;
  requiresOpenaiAuth: boolean;
};

type CodexRateLimitsResponse = {
  rateLimits: CodexRateLimitSnapshot;
  rateLimitsByLimitId: Record<string, CodexRateLimitSnapshot> | null;
};

function send(child: ReturnType<typeof spawn>, id: number, method: string, params?: unknown): void {
  if (!child.stdin) {
    throw new Error("Codex app-server stdin is unavailable");
  }
  child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
}

function parseJsonLines(buffer: string): { messages: JsonRpcMessage[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const messages: JsonRpcMessage[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line) as JsonRpcMessage);
    } catch {
      // Ignore non-JSON log lines from the experimental app-server.
    }
  }

  return { messages, rest };
}

export async function readCodexAccountUsage(timeoutMs = 15_000): Promise<{
  account: CodexAccountResponse;
  rateLimits: CodexRateLimitsResponse;
}> {
  const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  let initialized = false;
  let account: CodexAccountResponse | undefined;
  let rateLimits: CodexRateLimitsResponse | undefined;

  return await new Promise((resolve, reject) => {
    let settled = false;

    function stopChild(): void {
      child.stdin?.end();

      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }

    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stopChild();
      reject(error);
    }

    function finishIfReady(): void {
      if (!account || !rateLimits || settled) return;
      settled = true;
      clearTimeout(timeout);
      const resolvedAccount = account;
      const resolvedRateLimits = rateLimits;
      stopChild();

      const killTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 1_000);

      child.once("close", () => {
        clearTimeout(killTimer);
        resolve({ account: resolvedAccount, rateLimits: resolvedRateLimits });
      });
    }

    const timeout = setTimeout(() => {
      fail(new Error(`Timed out reading Codex account usage. ${stderr.trim()}`));
    }, timeoutMs);

    function handleMessage(message: JsonRpcMessage): void {
      if (message.error) {
        fail(new Error(message.error.message ?? "Codex app-server returned an error"));
        return;
      }

      if (message.id === 1 && !initialized) {
        initialized = true;
        send(child, 2, "account/read", { refreshToken: false });
        send(child, 3, "account/rateLimits/read");
        return;
      }

      if (message.id === 2) {
        account = message.result as CodexAccountResponse;
        finishIfReady();
        return;
      }

      if (message.id === 3) {
        rateLimits = message.result as CodexRateLimitsResponse;
        finishIfReady();
      }
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const parsed = parseJsonLines(stdout);
      stdout = parsed.rest;
      for (const message of parsed.messages) {
        handleMessage(message);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      fail(error);
    });

    child.on("exit", (code) => {
      if (settled) return;
      fail(new Error(`Codex app-server exited before returning usage (code ${code}). ${stderr.trim()}`));
    });

    send(child, 1, "initialize", {
      clientInfo: { name: "telegram-agent-bot", title: "Telegram Agent Bot", version: "0.1.0" },
      capabilities: { experimentalApi: true }
    });
  });
}

function formatReset(epochSeconds: number | null): string {
  if (!epochSeconds) return "unknown";
  return new Date(epochSeconds * 1000).toLocaleString();
}

function formatWindow(label: string, window: CodexRateLimitWindow | null): string[] {
  if (!window) return [`${label}: unavailable`];
  return [
    `${label}: ${window.usedPercent}% used`,
    `  Window: ${window.windowDurationMins ?? "unknown"} minutes`,
    `  Resets: ${formatReset(window.resetsAt)}`
  ];
}

export async function formatCodexAccountUsageReport(): Promise<string> {
  const { account, rateLimits } = await readCodexAccountUsage();
  const activeLimits = rateLimits.rateLimitsByLimitId?.codex ?? rateLimits.rateLimits;
  const accountText = account.account?.type === "chatgpt"
    ? `${account.account.email} (${account.account.planType})`
    : account.account?.type ?? "not logged in";

  return [
    "Codex account usage:",
    `Account: ${accountText}`,
    `Limit: ${activeLimits.limitId ?? "unknown"}`,
    `Plan: ${activeLimits.planType ?? "unknown"}`,
    ...formatWindow("Primary limit", activeLimits.primary),
    ...formatWindow("Secondary limit", activeLimits.secondary),
    activeLimits.credits
      ? `Credits: ${activeLimits.credits.unlimited ? "unlimited" : activeLimits.credits.balance ?? "unknown"}`
      : "Credits: unavailable",
    activeLimits.rateLimitReachedType ? `Limit reached: ${activeLimits.rateLimitReachedType}` : "Limit reached: no"
  ].join("\n");
}

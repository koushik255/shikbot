import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { loginOpenAICodex } from "@earendil-works/pi-ai/oauth";
import { authPath, loadAuth, saveAuth } from "./auth.js";

const ENV_PATH = ".env";
const CODEX_DEFAULTS = {
  PI_PROVIDER: "openai-codex",
  PI_MODEL: "gpt-5.5"
} as const;

/**
 * Update or insert the given key/value pairs in `.env`, preserving any other
 * lines (and order) already present.
 */
function upsertEnv(values: Record<string, string>): void {
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8").split(/\r?\n/u) : [];
  const remaining = new Map(Object.entries(values));

  const lines = existing.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/u);
    const key = match?.[1];
    if (key === undefined) return line;

    const replacement = remaining.get(key);
    if (replacement === undefined) return line;

    remaining.delete(key);
    return `${key}=${replacement}`;
  });

  for (const [key, value] of remaining) {
    lines.push(`${key}=${value}`);
  }

  // Drop a trailing blank line so the file ends with exactly one newline.
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  writeFileSync(ENV_PATH, `${lines.join("\n")}\n`);
}

/** Start `npm run dev` with the Codex provider env, returning its exit code. */
function runDevServer(): Promise<number | null> {
  const child = spawn("npm", ["run", "dev"], {
    stdio: "inherit",
    env: { ...process.env, ...CODEX_DEFAULTS }
  });

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
}

async function loginAndSaveCredentials(): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    const credentials = await loginOpenAICodex({
      onAuth: ({ url, instructions }) => {
        console.log("\nOpen this URL to log in with ChatGPT Plus/Pro Codex:\n");
        console.log(url);
        if (instructions) console.log(`\n${instructions}`);
        console.log("\nIf the browser callback cannot reach this machine, paste the code below.\n");
      },
      onPrompt: async (prompt) => (await rl.question(`${prompt.message} `)).trim(),
      onManualCodeInput: async () =>
        (await rl.question("Paste OAuth code, or press Enter if browser callback succeeds: ")).trim(),
      onProgress: (message) => console.log(message),
      originator: "telegram-agent-bot"
    });

    const auth = loadAuth();
    auth["openai-codex"] = { type: "oauth", ...credentials };
    saveAuth(auth);
    upsertEnv({ ...CODEX_DEFAULTS });

    console.log(`\nSaved OpenAI Codex credentials to ${authPath}`);
    console.log(
      `Updated .env with PI_PROVIDER=${CODEX_DEFAULTS.PI_PROVIDER} and PI_MODEL=${CODEX_DEFAULTS.PI_MODEL}`
    );
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  // pi-ai loads Node-only OAuth dependencies with dynamic imports so browser
  // builds do not bundle them. Under tsx, our top-level code can run before
  // those imports settle, so yield briefly first.
  await delay(100);

  await loginAndSaveCredentials();

  console.log("\nStarting bot with npm run dev...\n");
  const code = await runDevServer();
  process.exitCode = code ?? 0;
}

await main();

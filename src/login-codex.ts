import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loginOpenAICodex } from "@mariozechner/pi-ai/oauth";
import { authPath, loadAuth, saveAuth } from "./auth.js";

const rl = createInterface({ input, output });
const envPath = ".env";

function upsertEnv(values: Record<string, string>): void {
  const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/u) : [];
  const seen = new Set<string>();
  const updated = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/u);
    if (!match) {
      return line;
    }

    const key = match[1];
    if (!(key in values)) {
      return line;
    }

    seen.add(key);
    return `${key}=${values[key]}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) {
      updated.push(`${key}=${value}`);
    }
  }

  writeFileSync(envPath, `${updated.filter((line, index) => line.length > 0 || index < updated.length - 1).join("\n")}\n`);
}

function runDevServer(): Promise<number | null> {
  const child = spawn("npm", ["run", "dev"], {
    stdio: "inherit",
    env: {
      ...process.env,
      PI_PROVIDER: "openai-codex",
      PI_MODEL: "gpt-5.5"
    }
  });

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code));
  });
}

let startDevServer = false;

// pi-ai loads Node-only OAuth dependencies with dynamic imports so browser builds do not
// bundle them. Under tsx, our top-level code can run before those imports settle.
// Yield briefly before starting the Codex OAuth flow.
await new Promise((resolve) => setTimeout(resolve, 100));

try {
  const credentials = await loginOpenAICodex({
    onAuth: ({ url, instructions }) => {
      console.log("\nOpen this URL to log in with ChatGPT Plus/Pro Codex:\n");
      console.log(url);
      if (instructions) {
        console.log(`\n${instructions}`);
      }
      console.log("\nIf the browser callback cannot reach this machine, paste the code below.\n");
    },
    onPrompt: async (prompt) => {
      const answer = await rl.question(`${prompt.message} `);
      return answer.trim();
    },
    onManualCodeInput: async () => {
      const answer = await rl.question("Paste OAuth code, or press Enter if browser callback succeeds: ");
      return answer.trim();
    },
    onProgress: (message) => console.log(message),
    originator: "telegram-agent-bot"
  });

  const auth = loadAuth();
  auth["openai-codex"] = {
    type: "oauth",
    ...credentials
  };
  saveAuth(auth);

  upsertEnv({
    PI_PROVIDER: "openai-codex",
    PI_MODEL: "gpt-5.5"
  });

  console.log(`\nSaved OpenAI Codex credentials to ${authPath}`);
  console.log("Updated .env with PI_PROVIDER=openai-codex and PI_MODEL=gpt-5.5");
  startDevServer = true;
} finally {
  rl.close();
}

if (startDevServer) {
  console.log("\nStarting bot with npm run dev...\n");
  const code = await runDevServer();
  process.exitCode = code ?? 0;
}

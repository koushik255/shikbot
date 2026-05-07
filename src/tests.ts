import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "telegram-agent-bot-test-"));
process.env.PI_AUTH_FILE = join(tempDir, "auth.json");
process.env.PI_USAGE_FILE = join(tempDir, "usage.json");
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.OWNER_TELEGRAM_IDS = "123,456";
process.env.PI_PROVIDER = "openai";
process.env.PI_MODEL = "gpt-5-mini";
process.env.PI_THINKING_LEVEL = "medium";

const approvals = await import("./approvals.js");
const auth = await import("./auth.js");
const usage = await import("./usage.js");
const telegram = await import("./telegram.js");

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test("saveAuth/loadAuth round-trips OAuth credentials", () => {
  auth.saveAuth({
    "openai-codex": {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: 4_102_444_800_000
    }
  });

  assert.deepEqual(auth.loadAuth(), {
    "openai-codex": {
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: 4_102_444_800_000
    }
  });
});

test("getProviderApiKey prefers environment API keys", async () => {
  process.env.OPENAI_API_KEY = "sk-test-env-key";

  const key = await auth.getProviderApiKey("openai");

  assert.equal(key, "sk-test-env-key");
  delete process.env.OPENAI_API_KEY;
});

test("recordUsageFromMessage tracks assistant usage", () => {
  usage.recordUsageFromMessage({
    role: "assistant",
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.5",
    content: [],
    usage: {
      input: 100,
      output: 50,
      cacheRead: 20,
      cacheWrite: 10,
      totalTokens: 180,
      cost: {
        input: 0.001,
        output: 0.002,
        cacheRead: 0.0001,
        cacheWrite: 0.0002,
        total: 0.0033
      }
    },
    stopReason: "stop",
    timestamp: Date.now()
  });

  const totals = usage.loadUsage().totals;
  assert.equal(totals.requests, 1);
  assert.equal(totals.input, 100);
  assert.equal(totals.output, 50);
  assert.equal(totals.totalTokens, 180);
  assert.equal(totals.cost.total, 0.0033);
});

test("approval flow resolves yes/no responses", async () => {
  const approvalPromise = approvals.requestCommandApproval(123, "echo hello", tempDir);

  assert.equal(approvals.hasPendingApproval(123), true);
  assert.equal(approvals.resolveApprovalFromText(123, "yes"), "approved");
  assert.equal(await approvalPromise, true);
  assert.equal(approvals.hasPendingApproval(123), false);

  const deniedPromise = approvals.requestCommandApproval(123, "echo nope", tempDir);
  assert.equal(approvals.resolveApprovalFromText(123, "/no"), "denied");
  assert.equal(await deniedPromise, false);
});

test("isAllowedUser accepts only configured Telegram owner IDs", () => {
  assert.equal(telegram.isAllowedUser(123), true);
  assert.equal(telegram.isAllowedUser(456), true);
  assert.equal(telegram.isAllowedUser(789), false);
  assert.equal(telegram.isAllowedUser(undefined), false);
});

test("replyInChunks preserves text and respects Telegram-sized chunks", async () => {
  const text = "x".repeat(8_001);
  const chunks: string[] = [];

  await telegram.replyInChunks(async (chunk) => {
    chunks.push(chunk);
  }, text);

  assert.equal(chunks.length, 3);
  assert.equal(chunks.join(""), text);
  assert.ok(chunks.every((chunk) => chunk.length <= 3_900));
});

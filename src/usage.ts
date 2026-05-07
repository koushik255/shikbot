import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Usage } from "@mariozechner/pi-ai";

export type UsageTotals = Usage & {
  requests: number;
};

export type UsageFile = {
  totals: UsageTotals;
  byProvider: Record<string, UsageTotals>;
  byModel: Record<string, UsageTotals>;
};

export const usagePath = resolve(process.env.PI_USAGE_FILE ?? ".pi-usage.json");

const emptyUsage: UsageTotals = {
  requests: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0
  }
};

function createUsageFile(): UsageFile {
  return {
    totals: structuredClone(emptyUsage),
    byProvider: {},
    byModel: {}
  };
}

export function loadUsage(): UsageFile {
  if (!existsSync(usagePath)) {
    return createUsageFile();
  }

  return JSON.parse(readFileSync(usagePath, "utf8")) as UsageFile;
}

export function saveUsage(usage: UsageFile): void {
  mkdirSync(dirname(usagePath), { recursive: true });
  writeFileSync(usagePath, `${JSON.stringify(usage, null, 2)}\n`);
}

function addUsage(total: UsageTotals, usage: Usage): void {
  total.requests += 1;
  total.input += usage.input;
  total.output += usage.output;
  total.cacheRead += usage.cacheRead;
  total.cacheWrite += usage.cacheWrite;
  total.totalTokens += usage.totalTokens;
  total.cost.input += usage.cost.input;
  total.cost.output += usage.cost.output;
  total.cost.cacheRead += usage.cost.cacheRead;
  total.cost.cacheWrite += usage.cost.cacheWrite;
  total.cost.total += usage.cost.total;
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === "assistant" && "usage" in message;
}

export function recordUsageFromMessage(message: AgentMessage): void {
  if (!isAssistantMessage(message)) {
    return;
  }

  const usageFile = loadUsage();
  addUsage(usageFile.totals, message.usage);

  usageFile.byProvider[message.provider] ??= structuredClone(emptyUsage);
  addUsage(usageFile.byProvider[message.provider], message.usage);

  const modelKey = `${message.provider}/${message.model}`;
  usageFile.byModel[modelKey] ??= structuredClone(emptyUsage);
  addUsage(usageFile.byModel[modelKey], message.usage);

  saveUsage(usageFile);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatTotals(label: string, totals: UsageTotals): string {
  return [
    `${label}:`,
    `  Requests: ${formatNumber(totals.requests)}`,
    `  Input tokens: ${formatNumber(totals.input)}`,
    `  Output tokens: ${formatNumber(totals.output)}`,
    `  Cache read tokens: ${formatNumber(totals.cacheRead)}`,
    `  Cache write tokens: ${formatNumber(totals.cacheWrite)}`,
    `  Total tokens: ${formatNumber(totals.totalTokens)}`,
    `  Estimated cost: ${formatCost(totals.cost.total)}`
  ].join("\n");
}

export function formatUsageReport(provider?: string): string {
  const usage = loadUsage();
  const sections = [formatTotals("Bot-tracked usage", usage.totals)];

  if (provider && usage.byProvider[provider]) {
    sections.push(formatTotals(`Provider ${provider}`, usage.byProvider[provider]));
  }

  const models = Object.entries(usage.byModel)
    .sort(([, a], [, b]) => b.totalTokens - a.totalTokens)
    .slice(0, 5);

  if (models.length > 0) {
    sections.push([
      "Top models:",
      ...models.map(([model, totals]) =>
        `  ${model}: ${formatNumber(totals.totalTokens)} tokens, ${formatCost(totals.cost.total)}`
      )
    ].join("\n"));
  }

  return `${sections.join("\n\n")}\n\nNote: this only tracks usage from this Telegram bot, not your whole Codex account.`;
}

import { resolve } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import { createJsonStore } from "./json-store.js";

/** Aggregate usage record kept on disk. */
export type UsageTotals = Usage & {
  requests: number;
};

/** Shape of `.pi-usage.json`. */
export type UsageFile = {
  totals: UsageTotals;
  byProvider: Record<string, UsageTotals>;
  byModel: Record<string, UsageTotals>;
};

const TOP_MODELS_LIMIT = 5;

export const usagePath = resolve(process.env["PI_USAGE_FILE"] ?? ".pi-usage.json");

const usageStore = createJsonStore<UsageFile>({
  path: usagePath,
  defaults: createEmptyUsageFile,
  mode: 0o644
});

export function loadUsage(): UsageFile {
  return usageStore.load();
}

export function saveUsage(usage: UsageFile): void {
  usageStore.save(usage);
}

/**
 * Add `message`'s usage to the on-disk totals (overall + per-provider +
 * per-model). No-op for non-assistant messages.
 */
export function recordUsageFromMessage(message: AgentMessage): void {
  if (!isAssistantMessage(message)) return;

  const file = loadUsage();
  const modelKey = `${message.provider}/${message.model}`;

  addUsage(file.totals, message.usage);
  addUsage(getOrCreateBucket(file.byProvider, message.provider), message.usage);
  addUsage(getOrCreateBucket(file.byModel, modelKey), message.usage);

  saveUsage(file);
}

export function formatUsageReport(provider?: string): string {
  const usage = loadUsage();
  const sections = [formatTotals("Bot-tracked usage", usage.totals)];

  const providerTotals = provider ? usage.byProvider[provider] : undefined;
  if (provider && providerTotals) {
    sections.push(formatTotals(`Provider ${provider}`, providerTotals));
  }

  const topModels = Object.entries(usage.byModel)
    .sort(([, a], [, b]) => b.totalTokens - a.totalTokens)
    .slice(0, TOP_MODELS_LIMIT);

  if (topModels.length > 0) {
    sections.push([
      "Top models:",
      ...topModels.map(([model, totals]) =>
        `  ${model}: ${formatNumber(totals.totalTokens)} tokens, ${formatCost(totals.cost.total)}`
      )
    ].join("\n"));
  }

  return `${sections.join("\n\n")}\n\nNote: this only tracks usage from this Telegram bot, not your whole Codex account.`;
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === "assistant" && "usage" in message;
}

function createEmptyUsage(): UsageTotals {
  return {
    requests: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
}

function createEmptyUsageFile(): UsageFile {
  return { totals: createEmptyUsage(), byProvider: {}, byModel: {} };
}

function getOrCreateBucket(record: Record<string, UsageTotals>, key: string): UsageTotals {
  return (record[key] ??= createEmptyUsage());
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

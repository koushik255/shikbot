import { Telegraf, type Context } from "telegraf";
import { message } from "telegraf/filters";
import { askAgent, resetAgent } from "./agent.js";
import { resolveApprovalFromText, setApprovalNotifier } from "./approvals.js";
import { config } from "./config.js";
import { formatCodexAccountUsageReport } from "./codex-account.js";
import { downloadTorrent, formatDownloadTorrentResult } from "./tools/download-torrent.js";
import { formatUsageReport } from "./usage.js";

const TELEGRAM_MAX_MESSAGE_LENGTH = 3_900;

const START_MESSAGE =
  "Pi core agent bot is online. Send a message, use /ask <prompt>, /torrent <magnet-or-torrent-url>, /usage, or /reset.";
const TORRENT_USAGE = "Usage: /torrent <magnet link | .torrent URL | local .torrent path>";
const ASK_USAGE = "Usage: /ask <message>";
const NO_PENDING_APPROVAL = "No pending approval for this chat.";

export function isAllowedUser(userId: number | undefined): boolean {
  return typeof userId === "number" && config.ownerTelegramIds.has(userId);
}

/** Send `text` to Telegram, splitting it across messages to fit the API limit. */
export async function replyInChunks(reply: (text: string) => Promise<unknown>, text: string): Promise<void> {
  for (let i = 0; i < text.length; i += TELEGRAM_MAX_MESSAGE_LENGTH) {
    await reply(text.slice(i, i + TELEGRAM_MAX_MESSAGE_LENGTH));
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function replyChunked(ctx: Context, text: string): Promise<void> {
  return replyInChunks((chunk) => ctx.reply(chunk), text);
}

function capitalize<T extends string>(value: T): Capitalize<T> {
  return (value.charAt(0).toUpperCase() + value.slice(1)) as Capitalize<T>;
}

export function createTelegramBot(): Telegraf {
  const bot = new Telegraf(config.telegramBotToken);

  setApprovalNotifier((chatId, approvalMessage) =>
    replyInChunks((text) => bot.telegram.sendMessage(chatId, text), approvalMessage)
  );

  bot.use(async (ctx, next) => {
    if (!isAllowedUser(ctx.from?.id)) {
      console.warn("Unauthorized Telegram user:", {
        id: ctx.from?.id,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name
      });
      await ctx.reply("Unauthorized.");
      return;
    }
    await next();
  });

  bot.start((ctx) => ctx.reply(START_MESSAGE));

  bot.command("reset", async (ctx) => {
    resetAgent(ctx.chat.id);
    await ctx.reply("Session reset.");
  });

  bot.command("usage", async (ctx) => {
    await ctx.sendChatAction("typing");
    const localUsage = formatUsageReport(config.piProvider);

    try {
      const accountUsage = await formatCodexAccountUsageReport();
      await replyChunked(ctx, `${accountUsage}\n\n${localUsage}`);
    } catch (error) {
      console.error("Failed to read Codex account usage:", error);
      await replyChunked(
        ctx,
        `Could not read Codex account usage.\n\n${describeError(error)}\n\n${localUsage}`
      );
    }
  });

  bot.command("torrent", async (ctx) => {
    const uri = ctx.payload.trim();
    if (!uri) {
      await ctx.reply(TORRENT_USAGE);
      return;
    }

    await ctx.reply("Starting torrent download with aria2c...");
    await ctx.sendChatAction("typing");

    try {
      const result = await downloadTorrent({ uri, cwd: process.cwd() });
      await replyChunked(ctx, formatDownloadTorrentResult(result));
    } catch (error) {
      await replyChunked(ctx, `Torrent download failed:\n${describeError(error)}`);
    }
  });

  bot.command("yes", async (ctx) => {
    const decision = resolveApprovalFromText(ctx.chat.id, "/yes");
    await ctx.reply(decision === "approved" ? "Approved." : NO_PENDING_APPROVAL);
  });

  bot.command("no", async (ctx) => {
    const decision = resolveApprovalFromText(ctx.chat.id, "/no");
    await ctx.reply(decision === "denied" ? "Denied." : NO_PENDING_APPROVAL);
  });

  bot.command("ask", async (ctx) => {
    const prompt = ctx.payload.trim();
    if (!prompt) {
      await ctx.reply(ASK_USAGE);
      return;
    }

    await ctx.sendChatAction("typing");
    const response = await askAgent(ctx.chat.id, prompt);
    await replyChunked(ctx, response);
  });

  bot.on(message("text"), async (ctx) => {
    const decision = resolveApprovalFromText(ctx.chat.id, ctx.message.text);
    if (decision) {
      await ctx.reply(`${capitalize(decision)}.`);
      return;
    }

    await ctx.sendChatAction("typing");
    const response = await askAgent(ctx.chat.id, ctx.message.text);
    await replyChunked(ctx, response);
  });

  bot.catch((error) => {
    console.error("Telegram bot error:", error);
  });

  return bot;
}

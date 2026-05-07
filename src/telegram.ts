import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { askAgent, resetAgent } from "./agent.js";
import { resolveApprovalFromText, setApprovalNotifier } from "./approvals.js";
import { config } from "./config.js";
import { formatCodexAccountUsageReport } from "./codex-account.js";
import { formatUsageReport } from "./usage.js";

export function isAllowedUser(userId: number | undefined): boolean {
  return typeof userId === "number" && config.ownerTelegramIds.has(userId);
}

export async function replyInChunks(reply: (text: string) => Promise<unknown>, text: string): Promise<void> {
  const maxLength = 3900;

  for (let i = 0; i < text.length; i += maxLength) {
    await reply(text.slice(i, i + maxLength));
  }
}

export function createTelegramBot(): Telegraf {
  const bot = new Telegraf(config.telegramBotToken);

  setApprovalNotifier(async (chatId, approvalMessage) => {
    await replyInChunks((text) => bot.telegram.sendMessage(chatId, text), approvalMessage);
  });

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

  bot.start(async (ctx) => {
    await ctx.reply("Pi core agent bot is online. Send a message, use /ask <prompt>, /usage, or /reset.");
  });

  bot.command("reset", async (ctx) => {
    resetAgent(ctx.chat.id);
    await ctx.reply("Session reset.");
  });

  bot.command("usage", async (ctx) => {
    await ctx.sendChatAction("typing");

    try {
      const accountUsage = await formatCodexAccountUsageReport();
      const localUsage = formatUsageReport(config.piProvider);
      await replyInChunks((text) => ctx.reply(text), `${accountUsage}\n\n${localUsage}`);
    } catch (error) {
      console.error("Failed to read Codex account usage:", error);
      await replyInChunks(
        (text) => ctx.reply(text),
        `Could not read Codex account usage.\n\n${error instanceof Error ? error.message : String(error)}\n\n${formatUsageReport(config.piProvider)}`
      );
    }
  });

  bot.command("yes", async (ctx) => {
    const decision = resolveApprovalFromText(ctx.chat.id, "/yes");
    await ctx.reply(decision === "approved" ? "Approved." : "No pending approval for this chat.");
  });

  bot.command("no", async (ctx) => {
    const decision = resolveApprovalFromText(ctx.chat.id, "/no");
    await ctx.reply(decision === "denied" ? "Denied." : "No pending approval for this chat.");
  });

  bot.command("ask", async (ctx) => {
    const prompt = ctx.message.text.replace(/^\/ask(@\w+)?\s*/u, "").trim();

    if (!prompt) {
      await ctx.reply("Usage: /ask <message>");
      return;
    }

    await ctx.sendChatAction("typing");
    const response = await askAgent(ctx.chat.id, prompt);
    await replyInChunks((text) => ctx.reply(text), response);
  });

  bot.on(message("text"), async (ctx) => {
    const approvalDecision = resolveApprovalFromText(ctx.chat.id, ctx.message.text);
    if (approvalDecision) {
      await ctx.reply(approvalDecision === "approved" ? "Approved." : "Denied.");
      return;
    }

    await ctx.sendChatAction("typing");
    const response = await askAgent(ctx.chat.id, ctx.message.text);
    await replyInChunks((text) => ctx.reply(text), response);
  });

  bot.catch((error) => {
    console.error("Telegram bot error:", error);
  });

  return bot;
}

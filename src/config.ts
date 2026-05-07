import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  OWNER_TELEGRAM_IDS: z.string().min(1),
  PI_PROVIDER: z.string().min(1).default("openai"),
  PI_MODEL: z.string().min(1).default("gpt-5-mini"),
  PI_THINKING_LEVEL: z
    .enum(["off", "minimal", "low", "medium", "high", "xhigh"])
    .default("medium")
});

const env = envSchema.parse(process.env);

export const config = {
  telegramBotToken: env.TELEGRAM_BOT_TOKEN,
  piProvider: env.PI_PROVIDER,
  piModel: env.PI_MODEL,
  piThinkingLevel: env.PI_THINKING_LEVEL,
  ownerTelegramIds: new Set(
    env.OWNER_TELEGRAM_IDS.split(",")
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id))
  )
};

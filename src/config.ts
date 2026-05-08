import "dotenv/config";
import { getProviders, type KnownProvider } from "@earendil-works/pi-ai";
import { z } from "zod";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  OWNER_TELEGRAM_IDS: z.string().min(1),
  PI_PROVIDER: z
    .string()
    .min(1)
    .default("openai")
    .refine(
      (value): value is KnownProvider => (getProviders() as string[]).includes(value),
      (value) => ({ message: `Unknown PI_PROVIDER "${value}"` })
    ),
  PI_MODEL: z.string().min(1).default("gpt-5-mini"),
  PI_THINKING_LEVEL: z.enum(THINKING_LEVELS).default("medium")
});

const env = envSchema.parse(process.env);

const ownerTelegramIds: ReadonlySet<number> = new Set(
  env.OWNER_TELEGRAM_IDS.split(",")
    .map((id) => Number(id.trim()))
    .filter(Number.isInteger)
);

export const config = {
  telegramBotToken: env.TELEGRAM_BOT_TOKEN,
  piProvider: env.PI_PROVIDER,
  piModel: env.PI_MODEL,
  piThinkingLevel: env.PI_THINKING_LEVEL,
  ownerTelegramIds
} as const;

export type AppConfig = typeof config;

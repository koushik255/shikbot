import { createTelegramBot } from "./telegram.js";

const bot = createTelegramBot();

process.once("SIGINT", () => {
  bot.stop("SIGINT");
});

process.once("SIGTERM", () => {
  bot.stop("SIGTERM");
});

await bot.launch();
console.log("Telegram agent bot started.");

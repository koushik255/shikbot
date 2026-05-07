# Telegram Agent Bot

A small TypeScript bot that lets an allowed Telegram user talk to a Pi core agent running on your server.

This is intentionally not an OpenClaw clone. The first version is a server-side assistant with explicit tool boundaries.

## Setup

1. Create a Telegram bot with BotFather and get the bot token.
2. Copy `.env.example` to `.env`.
3. Fill in `TELEGRAM_BOT_TOKEN`, `OWNER_TELEGRAM_IDS`, and the API key for your selected Pi provider.
   For the default `PI_PROVIDER=fireworks`, set `FIREWORKS_API_KEY`.
   To use ChatGPT Plus/Pro Codex OAuth instead, run `npm run login:codex`, then set `PI_PROVIDER=openai-codex` and a Codex model such as `PI_MODEL=gpt-5.5`.
4. Install dependencies:

```bash
npm install
```

5. Run locally:

```bash
npm run dev
```

## Codex OAuth

This project uses the same `@mariozechner/pi-ai` OAuth helper that pi uses. Login once from the server shell:

```bash
npm run login:codex
```

Credentials are saved to `.pi-auth.json` by default and refreshed automatically by `src/auth.ts` when the agent needs an API key. You can change the path with `PI_AUTH_FILE`.

Usage is tracked locally in `.pi-usage.json` for requests made through this Telegram bot. This does not include Codex usage from other apps or the official Codex CLI.

## Commands

- `/start` shows basic status.
- `/ask <message>` sends a prompt to the agent.
- `/reset` resets the current Telegram chat's in-memory agent session.
- `/usage` shows Codex account rate-limit usage from the Codex app-server, plus locally tracked token/cost usage for this bot.
- `/yes` approves a pending agent command execution request.
- `/no` denies a pending agent command execution request.
- Any normal text message is also treated as an agent prompt. If a command approval is pending, replying `yes` or `no` resolves it instead.

## Safety Model

Only Telegram user IDs listed in `OWNER_TELEGRAM_IDS` can use the bot. Most tools are explicit TypeScript functions under `src/tools/`. The `execute_command` tool can run arbitrary shell commands, but only after the Telegram user approves the exact command with `yes`/`no` or `/yes`/`/no`.

Each Telegram chat gets its own agent session and current directory. The current directory starts as the directory where `npm run dev` was launched. The agent can use `change_directory` to move into child directories, parent directories like `..`, sibling projects, or absolute paths.

## Direction

The bot should stay server-native and tool-driven:

- Telegram is the control surface.
- `@mariozechner/pi-agent-core` is the stateful agent loop.
- `@mariozechner/pi-ai` provides provider/model integration.
- This service owns permissions, state, tool execution, and progress updates.
- Tools should be explicit TypeScript functions with schemas.
- Risky actions should require a separate approval flow before execution.
# shikbot

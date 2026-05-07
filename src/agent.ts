import { Agent, type AgentEvent, type ThinkingLevel } from "@mariozechner/pi-agent-core";
import { getModel, type KnownProvider } from "@mariozechner/pi-ai";
import { getProviderApiKey } from "./auth.js";
import { config } from "./config.js";
import { createTools, type SessionToolState } from "./tools/index.js";
import { recordUsageFromMessage } from "./usage.js";

const systemPrompt = `
You are a pragmatic server-side agent controlled through Telegram.
Keep replies concise because Telegram is a chat interface.
Use workspace tools when they materially help answer the user.
Never claim to have changed files, run commands, or inspected the workspace unless a tool result confirms it.
`.trim();

type Session = {
  agent: Agent;
  currentText: string;
  toolState: SessionToolState;
};

const sessions = new Map<number, Session>();

function createAgent(chatId: number): Session {
  const toolState: SessionToolState = {
    cwd: process.cwd()
  };

  const agent = new Agent({
    sessionId: `telegram:${chatId}`,
    initialState: {
      systemPrompt,
      model: getModel(config.piProvider as KnownProvider, config.piModel as never),
      thinkingLevel: config.piThinkingLevel as ThinkingLevel,
      tools: createTools(toolState)
    },
    getApiKey: (provider) => getProviderApiKey(provider),
    toolExecution: "sequential"
  });

  const session: Session = {
    agent,
    currentText: "",
    toolState
  };

  agent.subscribe((event) => {
    handleAgentEvent(session, event);
  });

  return session;
}

function handleAgentEvent(session: Session, event: AgentEvent): void {
  switch (event.type) {
    case "message_update": {
      const update = event.assistantMessageEvent;

      if (update.type === "text_delta") {
        session.currentText += update.delta;
      }
      break;
    }
    case "message_end":
      recordUsageFromMessage(event.message);
      break;
    case "tool_execution_start":
      console.info(
        `running tool ${event.toolName} in ${session.toolState.cwd} with args ${JSON.stringify(event.args)}`
      );
      break;
    case "tool_execution_end":
      console.info(`finished tool ${event.toolName} (${event.isError ? "error" : "ok"})`);
      break;
  }
}

function getSession(chatId: number): Session {
  const existing = sessions.get(chatId);

  if (existing) {
    return existing;
  }

  const created = createAgent(chatId);
  sessions.set(chatId, created);
  return created;
}

export async function askAgent(chatId: number, prompt: string): Promise<string> {
  const session = getSession(chatId);
  session.currentText = "";

  if (session.agent.state.isStreaming) {
    session.agent.followUp({
      role: "user",
      content: prompt,
      timestamp: Date.now()
    });
    return "The agent is busy. I queued that as a follow-up message.";
  }

  await session.agent.prompt(prompt);

  if (session.agent.state.errorMessage) {
    return `Agent error: ${session.agent.state.errorMessage}`;
  }

  return session.currentText.trim() || "(no response)";
}

export function resetAgent(chatId: number): void {
  const session = getSession(chatId);
  session.agent.reset();
  session.currentText = "";
  session.toolState.cwd = process.cwd();
}

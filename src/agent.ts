import { Agent, type AgentEvent, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai";
import { getProviderApiKey } from "./auth.js";
import { config } from "./config.js";
import { createTools, type SessionToolState } from "./tools/index.js";
import { recordUsageFromMessage } from "./usage.js";

const SYSTEM_PROMPT = `
You are a pragmatic server-side agent controlled through Telegram.
Keep replies concise because Telegram is a chat interface.
Use workspace tools when they materially help answer the user.
Never claim to have changed files, run commands, or inspected the workspace unless a tool result confirms it.
`.trim();

const BUSY_RESPONSE = "The agent is busy. I queued that as a follow-up message.";
const EMPTY_RESPONSE = "(no response)";

/** Per-Telegram-chat agent state. */
type Session = {
  agent: Agent;
  /** Streaming response text accumulated since the last `askAgent` call. */
  responseText: string;
  toolState: SessionToolState;
};

const sessionsByChatId = new Map<number, Session>();

function createSession(chatId: number): Session {
  const toolState: SessionToolState = { chatId, cwd: process.cwd() };

  const agent = new Agent({
    sessionId: `telegram:${chatId}`,
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      // pi-ai's getModel narrows the model id by the provider literal; a
      // user-supplied env string can't satisfy that, so widen with `as never`.
      model: getModel(config.piProvider, config.piModel as never),
      thinkingLevel: config.piThinkingLevel satisfies ThinkingLevel,
      tools: createTools(toolState)
    },
    getApiKey: (provider) => getProviderApiKey(provider),
    toolExecution: "sequential"
  });

  const session: Session = { agent, responseText: "", toolState };
  agent.subscribe((event) => handleAgentEvent(session, event));
  return session;
}

function handleAgentEvent(session: Session, event: AgentEvent): void {
  switch (event.type) {
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta") {
        session.responseText += update.delta;
      }
      return;
    }
    case "message_end":
      recordUsageFromMessage(event.message);
      return;
    case "tool_execution_start":
      console.info(
        `running tool ${event.toolName} in ${session.toolState.cwd} with args ${JSON.stringify(event.args)}`
      );
      return;
    case "tool_execution_end":
      console.info(`finished tool ${event.toolName} (${event.isError ? "error" : "ok"})`);
      return;
  }
}

function getOrCreateSession(chatId: number): Session {
  const existing = sessionsByChatId.get(chatId);
  if (existing) return existing;

  const session = createSession(chatId);
  sessionsByChatId.set(chatId, session);
  return session;
}

/**
 * Send `prompt` to the per-chat agent and return its full text response.
 *
 * If the agent is already streaming, the prompt is queued as a follow-up and
 * a short notice is returned immediately.
 */
export async function askAgent(chatId: number, prompt: string): Promise<string> {
  const session = getOrCreateSession(chatId);
  session.responseText = "";

  if (session.agent.state.isStreaming) {
    session.agent.followUp({
      role: "user",
      content: prompt,
      timestamp: Date.now()
    });
    return BUSY_RESPONSE;
  }

  await session.agent.prompt(prompt);

  const { errorMessage } = session.agent.state;
  if (errorMessage) return `Agent error: ${errorMessage}`;

  return session.responseText.trim() || EMPTY_RESPONSE;
}

/** Reset the agent transcript and working directory for `chatId`. */
export function resetAgent(chatId: number): void {
  const session = getOrCreateSession(chatId);
  session.agent.reset();
  session.responseText = "";
  session.toolState.cwd = process.cwd();
}

import path from "node:path";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "@earendil-works/pi-ai";

/** State threaded through every tool call for a single Telegram chat. */
export type SessionToolState = {
  chatId: number;
  cwd: string;
};

/** Default `details` payload when a tool only returns plain text. */
export type TextDetails = { readonly text: string };

/**
 * Build an AgentToolResult containing a single text block.
 *
 * Tools that surface structured data (e.g. process exit codes) can pass
 * `details` to expose it alongside the human-readable text.
 */
export function textResult(text: string): AgentToolResult<TextDetails>;
export function textResult<TDetails>(text: string, details: TDetails): AgentToolResult<TDetails>;
export function textResult(text: string, details?: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text }],
    details: details ?? { text }
  };
}

/** Resolve `relativePath` against the agent's current working directory. */
export function resolveFromCwd(cwd: string, relativePath: string): string {
  return path.resolve(cwd, relativePath);
}

type ToolContext = {
  signal?: AbortSignal;
  toolCallId: string;
};

type ToolExecutor<TParameters extends TSchema, TDetails> = (
  params: Static<TParameters>,
  ctx: ToolContext
) => Promise<AgentToolResult<TDetails>>;

/**
 * Spec accepted by `defineTool`: the standard `AgentTool` shape but with a
 * friendlier `execute` signature that receives typed `params` directly and
 * gathers `signal`/`toolCallId` into a single `ctx` argument.
 */
type ToolSpec<TParameters extends TSchema, TDetails> = Omit<
  AgentTool<TParameters, TDetails>,
  "execute"
> & {
  execute: ToolExecutor<TParameters, TDetails>;
};

/**
 * Build an `AgentTool` from a `ToolSpec`.
 *
 * The wrapper exists so each tool's body can use destructured, fully-typed
 * `params` (no `params as XParams` casts) and ignore the `toolCallId`/`signal`
 * positional arguments unless it cares about them.
 */
export function defineTool<TParameters extends TSchema, TDetails>(
  spec: ToolSpec<TParameters, TDetails>
): AgentTool<TParameters, TDetails> {
  const { execute, ...rest } = spec;
  return {
    ...rest,
    execute: (toolCallId, params, signal) => execute(params, { signal, toolCallId })
  };
}

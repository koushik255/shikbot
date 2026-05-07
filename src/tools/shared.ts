import path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";

export type SessionToolState = {
  cwd: string;
};

export type TextToolResult = AgentToolResult<{ text: string }>;

export function textResult(text: string): TextToolResult {
  return {
    content: [{ type: "text", text }],
    details: { text }
  };
}

export function resolveFromCwd(cwd: string, relativePath: string): string {
  return path.resolve(cwd, relativePath);
}

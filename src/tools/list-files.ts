import { readdir } from "node:fs/promises";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";
import { resolveFromCwd, textResult, type SessionToolState } from "./shared.js";

const listFilesSchema = Type.Object({
  relativePath: Type.Optional(Type.String({ default: "." }))
});

type ListFilesParams = Static<typeof listFilesSchema>;

export function createListFilesTool(state: SessionToolState): AgentTool {
  return {
    name: "list_files",
    label: "List files",
    description: "List files inside the current agent directory.",
    parameters: listFilesSchema,
    execute: async (_toolCallId, params) => {
      const input = params as ListFilesParams;
      const relativePath = input.relativePath ?? ".";
      const target = resolveFromCwd(state.cwd, relativePath);
      const entries = await readdir(target, { withFileTypes: true });
      const lines = entries
        .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
        .sort();

      return textResult(lines.join("\n") || "(empty)");
    }
  };
}

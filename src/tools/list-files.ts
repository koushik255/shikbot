import { readdir } from "node:fs/promises";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, resolveFromCwd, textResult, type SessionToolState } from "./shared.js";

const listFilesSchema = Type.Object({
  relativePath: Type.Optional(Type.String({ default: "." }))
});

export function createListFilesTool(state: SessionToolState): AgentTool {
  return defineTool({
    name: "list_files",
    label: "List files",
    description: "List files inside the current agent directory.",
    parameters: listFilesSchema,
    execute: async ({ relativePath = "." }) => {
      const target = resolveFromCwd(state.cwd, relativePath);
      const entries = await readdir(target, { withFileTypes: true });
      const lines = entries
        .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
        .sort();

      return textResult(lines.join("\n") || "(empty)");
    }
  });
}

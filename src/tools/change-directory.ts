import { stat } from "node:fs/promises";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, resolveFromCwd, textResult, type SessionToolState } from "./shared.js";

const changeDirectorySchema = Type.Object({
  relativePath: Type.String({
    description: "Path to change into. Relative paths are resolved against the current agent directory."
  })
});

export function createChangeDirectoryTool(state: SessionToolState): AgentTool {
  return defineTool({
    name: "change_directory",
    label: "Change directory",
    description: "Change the agent's current directory. Supports paths like src, .., ../other-project, and absolute paths.",
    parameters: changeDirectorySchema,
    executionMode: "sequential",
    execute: async ({ relativePath }) => {
      const target = resolveFromCwd(state.cwd, relativePath);
      const targetStat = await stat(target);

      if (!targetStat.isDirectory()) {
        throw new Error("Path is not a directory");
      }

      state.cwd = target;
      return textResult(`Current directory changed to ${state.cwd}`);
    }
  });
}

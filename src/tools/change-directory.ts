import { stat } from "node:fs/promises";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";
import { resolveFromCwd, textResult, type SessionToolState } from "./shared.js";

const changeDirectorySchema = Type.Object({
  relativePath: Type.String({
    description: "Path to change into. Relative paths are resolved against the current agent directory."
  })
});

type ChangeDirectoryParams = Static<typeof changeDirectorySchema>;

export function createChangeDirectoryTool(state: SessionToolState): AgentTool {
  return {
    name: "change_directory",
    label: "Change directory",
    description: "Change the agent's current directory. Supports paths like src, .., ../other-project, and absolute paths.",
    parameters: changeDirectorySchema,
    execute: async (_toolCallId, params) => {
      const input = params as ChangeDirectoryParams;
      const target = resolveFromCwd(state.cwd, input.relativePath);
      const targetStat = await stat(target);

      if (!targetStat.isDirectory()) {
        throw new Error("Path is not a directory");
      }

      state.cwd = target;
      return textResult(`Current directory changed to ${state.cwd}`);
    },
    executionMode: "sequential"
  };
}

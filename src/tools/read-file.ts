import { readFile, stat } from "node:fs/promises";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";
import { resolveFromCwd, textResult, type SessionToolState } from "./shared.js";

const readFileSchema = Type.Object({
  relativePath: Type.String()
});

type ReadFileParams = Static<typeof readFileSchema>;

export function createReadFileTool(state: SessionToolState): AgentTool {
  return {
    name: "read_file",
    label: "Read file",
    description: "Read a UTF-8 text file relative to the current agent directory.",
    parameters: readFileSchema,
    execute: async (_toolCallId, params) => {
      const input = params as ReadFileParams;
      const target = resolveFromCwd(state.cwd, input.relativePath);
      const fileStat = await stat(target);

      if (!fileStat.isFile()) {
        throw new Error("Path is not a file");
      }

      if (fileStat.size > 128_000) {
        throw new Error("File is too large to read through Telegram bot");
      }

      return textResult(await readFile(target, "utf8"));
    }
  };
}

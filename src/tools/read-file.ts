import { readFile, stat } from "node:fs/promises";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, resolveFromCwd, textResult, type SessionToolState } from "./shared.js";

const MAX_FILE_BYTES = 128_000;

const readFileSchema = Type.Object({
  relativePath: Type.String()
});

export function createReadFileTool(state: SessionToolState): AgentTool {
  return defineTool({
    name: "read_file",
    label: "Read file",
    description: "Read a UTF-8 text file relative to the current agent directory.",
    parameters: readFileSchema,
    execute: async ({ relativePath }) => {
      const target = resolveFromCwd(state.cwd, relativePath);
      const fileStat = await stat(target);

      if (!fileStat.isFile()) {
        throw new Error("Path is not a file");
      }

      if (fileStat.size > MAX_FILE_BYTES) {
        throw new Error("File is too large to read through Telegram bot");
      }

      return textResult(await readFile(target, "utf8"));
    }
  });
}

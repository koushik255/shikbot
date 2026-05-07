import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createChangeDirectoryTool } from "./change-directory.js";
import { createDownloadTorrentTool } from "./download-torrent.js";
import { createExecuteCommandTool } from "./execute-command.js";
import { createListFilesTool } from "./list-files.js";
import { createReadFileTool } from "./read-file.js";
import type { SessionToolState } from "./shared.js";

export type { SessionToolState } from "./shared.js";

export function createTools(state: SessionToolState): AgentTool[] {
  return [
    createListFilesTool(state),
    createReadFileTool(state),
    createChangeDirectoryTool(state),
    createExecuteCommandTool(state),
    createDownloadTorrentTool(state)
  ];
}

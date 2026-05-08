import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { requestCommandApproval } from "../approvals.js";
import { formatProcessResult, runProcess, type ProcessResult } from "../process.js";
import { defineTool, textResult, type SessionToolState } from "./shared.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

const executeCommandSchema = Type.Object({
  command: Type.String({
    description: "Shell command to run after explicit user approval. Runs with bash -lc in the current agent directory."
  }),
  timeoutMs: Type.Optional(Type.Number({
    description: "Optional timeout in milliseconds. Defaults to 30000 and is capped at 120000."
  }))
});

type CommandResult = ProcessResult & {
  command: string;
  cwd: string;
};

type ExecuteCommandDetails =
  | ({ kind: "executed" } & CommandResult)
  | { kind: "denied"; command: string };

function clampTimeout(value: number | undefined): number {
  return Math.min(Math.max(value ?? DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

function describeCommandResult(result: CommandResult): string {
  return formatProcessResult(result, [
    `Command: ${result.command}`,
    `Directory: ${result.cwd}`
  ]);
}

export function createExecuteCommandTool(state: SessionToolState): AgentTool {
  return defineTool({
    name: "execute_command",
    label: "Execute command",
    description:
      "Request user approval to execute an arbitrary shell command in the current agent directory. Use only when a command materially helps the task.",
    parameters: executeCommandSchema,
    executionMode: "sequential",
    execute: async ({ command, timeoutMs }, { signal }) => {
      const approved = await requestCommandApproval(state.chatId, command, state.cwd);
      if (!approved) {
        return textResult<ExecuteCommandDetails>(
          `User denied command execution: ${command}`,
          { kind: "denied", command }
        );
      }

      const processResult = await runProcess("bash", ["-lc", command], {
        cwd: state.cwd,
        timeoutMs: clampTimeout(timeoutMs),
        signal
      });
      const result: CommandResult = { ...processResult, command, cwd: state.cwd };
      return textResult<ExecuteCommandDetails>(
        describeCommandResult(result),
        { kind: "executed", ...result }
      );
    }
  });
}

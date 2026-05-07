import { spawn } from "node:child_process";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";
import { requestCommandApproval } from "../approvals.js";
import { textResult, type SessionToolState } from "./shared.js";

const executeCommandSchema = Type.Object({
  command: Type.String({
    description: "Shell command to run after explicit user approval. Runs with bash -lc in the current agent directory."
  }),
  timeoutMs: Type.Optional(Type.Number({
    description: "Optional timeout in milliseconds. Defaults to 30000 and is capped at 120000."
  }))
});

type ExecuteCommandParams = Static<typeof executeCommandSchema>;

type CommandResult = {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

const maxOutputChars = 24_000;

function truncateOutput(text: string): string {
  if (text.length <= maxOutputChars) {
    return text;
  }

  return `${text.slice(0, maxOutputChars)}\n\n[output truncated after ${maxOutputChars} characters]`;
}

async function runCommand(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
  const child = spawn("bash", ["-lc", command], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 1_000).unref();
  }, timeoutMs);

  const abort = () => {
    child.kill("SIGTERM");
  };
  signal?.addEventListener("abort", abort, { once: true });

  return await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      stdout = truncateOutput(stdout);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      stderr = truncateOutput(stderr);
    });

    child.on("error", reject);

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      resolve({ command, cwd, exitCode, stdout, stderr, timedOut });
    });
  });
}

function formatCommandResult(result: CommandResult): string {
  return [
    `Command: ${result.command}`,
    `Directory: ${result.cwd}`,
    `Exit code: ${result.exitCode ?? "unknown"}${result.timedOut ? " (timed out)" : ""}`,
    "",
    "stdout:",
    result.stdout || "(empty)",
    "",
    "stderr:",
    result.stderr || "(empty)"
  ].join("\n");
}

export function createExecuteCommandTool(state: SessionToolState): AgentTool {
  return {
    name: "execute_command",
    label: "Execute command",
    description:
      "Request user approval to execute an arbitrary shell command in the current agent directory. Use only when a command materially helps the task.",
    parameters: executeCommandSchema,
    execute: async (_toolCallId, params, signal) => {
      const input = params as ExecuteCommandParams;
      const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 30_000, 1_000), 120_000);
      const approved = await requestCommandApproval(state.chatId, input.command, state.cwd);

      if (!approved) {
        return textResult(`User denied command execution: ${input.command}`);
      }

      const result = await runCommand(input.command, state.cwd, timeoutMs, signal);
      return {
        ...textResult(formatCommandResult(result)),
        details: result
      };
    },
    executionMode: "sequential"
  };
}

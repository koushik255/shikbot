import { spawn, type SpawnOptions } from "node:child_process";

/** Outcome of a single child-process invocation. */
export type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

/**
 * Render a `ProcessResult` plus arbitrary header lines as a human-readable
 * block: header, exit code, then stdout/stderr sections.
 */
export function formatProcessResult(result: ProcessResult, header: readonly string[]): string {
  return [
    ...header,
    `Exit code: ${result.exitCode ?? "unknown"}${result.timedOut ? " (timed out)" : ""}`,
    "",
    "stdout:",
    result.stdout || "(empty)",
    "",
    "stderr:",
    result.stderr || "(empty)"
  ].join("\n");
}

export type RunProcessOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Time before the process is sent SIGTERM. No timeout if omitted. */
  timeoutMs?: number;
  /** Aborting the signal sends SIGTERM to the process. */
  signal?: AbortSignal;
  /** Per-stream output cap; longer output is truncated with a footer note. */
  maxOutputChars?: number;
  /** Time between SIGTERM and SIGKILL after a timeout fires. */
  killGraceMs?: number;
};

const DEFAULT_MAX_OUTPUT_CHARS = 24_000;
const DEFAULT_KILL_GRACE_MS = 1_000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[output truncated after ${max} characters]`;
}

/**
 * Spawn a child process, capture its output, and resolve with a
 * `ProcessResult`.
 *
 * - Output is truncated per stream to `maxOutputChars` (default 24 000).
 * - `timeoutMs` triggers SIGTERM, then SIGKILL after `killGraceMs`.
 * - `AbortSignal` triggers SIGTERM.
 * - Resolves on close (any exit code); rejects only on spawn errors.
 */
export function runProcess(
  command: string,
  args: readonly string[],
  options: RunProcessOptions = {}
): Promise<ProcessResult> {
  const {
    cwd,
    env,
    timeoutMs,
    signal,
    maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS,
    killGraceMs = DEFAULT_KILL_GRACE_MS
  } = options;

  const spawnOptions: SpawnOptions = {
    stdio: ["ignore", "pipe", "pipe"],
    cwd,
    env
  };
  const child = spawn(command, [...args], spawnOptions);

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  const killAfterTimeout = () => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, killGraceMs).unref();
  };

  const timeoutHandle = timeoutMs ? setTimeout(killAfterTimeout, timeoutMs) : undefined;

  const onAbort = () => child.kill("SIGTERM");
  signal?.addEventListener("abort", onAbort, { once: true });

  return new Promise<ProcessResult>((resolve, reject) => {
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = truncate(stdout + chunk.toString("utf8"), maxOutputChars);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = truncate(stderr + chunk.toString("utf8"), maxOutputChars);
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

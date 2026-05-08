import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

type CodexChild = ChildProcessByStdio<Writable, Readable, Readable>;

type JsonRpcResponse = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const KILL_GRACE_MS = 1_000;

const DEFAULT_CLIENT = {
  name: "telegram-agent-bot",
  title: "Telegram Agent Bot",
  version: "0.1.0"
} as const;

export type CodexRpcOptions = {
  /** Overall timeout for the whole exchange. */
  timeoutMs?: number;
  /** Identifying info sent in the `initialize` call. */
  client?: { name: string; title: string; version: string };
};

/** Caller's view of a running `codex app-server` JSON-RPC session. */
export type CodexRpcSession = {
  /** Send a request and resolve with its typed `result` when the response arrives. */
  request: <T>(method: string, params?: unknown) => Promise<T>;
};

/**
 * Spawn `codex app-server`, perform the JSON-RPC `initialize` handshake, run
 * `task` against the resulting session, and shut the child down afterwards.
 *
 * The child is always cleaned up: SIGTERM on success, SIGKILL after a grace
 * period if it does not exit on its own.
 */
export async function withCodexRpc<T>(
  task: (session: CodexRpcSession) => Promise<T>,
  options: CodexRpcOptions = {}
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, client = DEFAULT_CLIENT } = options;

  const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "pipe"]
  }) as CodexChild;

  const pending = new Map<number, Pending>();
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let nextId = 2; // id 1 is reserved for `initialize`.

  const sendRpc = (id: number, method: string, params?: unknown): void => {
    if (!child.stdin.writable) throw new Error("Codex app-server stdin is unavailable");
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  };

  const trackRequest = <U>(id: number): Promise<U> => {
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    pending.set(id, { resolve, reject });
    return promise as Promise<U>;
  };

  const session: CodexRpcSession = {
    request: <U>(method: string, params?: unknown) => {
      const id = nextId++;
      const promise = trackRequest<U>(id);
      try {
        sendRpc(id, method, params);
      } catch (error) {
        pending.delete(id);
        throw error;
      }
      return promise;
    }
  };

  const failAllPending = (error: Error): void => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };

  const handleMessage = (message: JsonRpcResponse): void => {
    if (message.id === undefined) return;
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);

    if (message.error) {
      handler.reject(new Error(message.error.message ?? "Codex app-server returned an error"));
    } else {
      handler.resolve(message.result);
    }
  };

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    const { messages, rest } = parseJsonLines(stdoutBuffer);
    stdoutBuffer = rest;
    for (const message of messages) handleMessage(message);
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderrBuffer += chunk.toString("utf8");
  });

  const childExit = new Promise<never>((_, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      if (pending.size > 0) {
        reject(new Error(`Codex app-server exited before returning (code ${code}). ${stderrBuffer.trim()}`));
      }
    });
  });

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`Timed out reading Codex app-server. ${stderrBuffer.trim()}`)),
      timeoutMs
    );
  });

  try {
    const initPromise = trackRequest<unknown>(1);
    sendRpc(1, "initialize", { clientInfo: client, capabilities: { experimentalApi: true } });
    await Promise.race([initPromise, childExit, timeout]);

    return await Promise.race([task(session), childExit, timeout]);
  } catch (error) {
    failAllPending(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    stopChild(child);
  }
}

function stopChild(child: CodexChild): void {
  child.stdin.end();
  if (!child.killed) child.kill("SIGTERM");
  setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, KILL_GRACE_MS).unref();
}

function parseJsonLines(buffer: string): { messages: JsonRpcResponse[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const messages: JsonRpcResponse[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line) as JsonRpcResponse);
    } catch {
      // Ignore non-JSON log lines from the experimental app-server.
    }
  }

  return { messages, rest };
}

import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";
import { requestCommandApproval } from "../approvals.js";
import { resolveFromCwd, textResult, type SessionToolState } from "./shared.js";

const downloadTorrentSchema = Type.Object({
  uri: Type.String({
    description: "Magnet URI, local .torrent path, or http(s) URL to a .torrent file. Only use for content the user has rights to download."
  }),
  outputDirectory: Type.Optional(Type.String({
    description: "Directory to save files into. Relative paths are resolved against the current agent directory. Defaults to /home/koushikk/MANGA."
  })),
  seedTimeMinutes: Type.Optional(Type.Number({
    description: "How long aria2c should seed after the download completes. Defaults to 0."
  })),
  timeoutMinutes: Type.Optional(Type.Number({
    description: "Maximum time to let aria2c run. Defaults to 120 minutes and is capped at 1440 minutes."
  }))
});

type DownloadTorrentParams = Static<typeof downloadTorrentSchema>;

type DownloadTorrentResult = {
  uri: string;
  outputDirectory: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

const maxOutputChars = 24_000;

function truncateOutput(text: string): string {
  if (text.length <= maxOutputChars) return text;
  return `${text.slice(0, maxOutputChars)}\n\n[output truncated after ${maxOutputChars} characters]`;
}

function validateTorrentUri(uri: string): void {
  if (uri.startsWith("magnet:?xt=urn:btih:")) return;

  if (uri.endsWith(".torrent")) return;

  try {
    const parsed = new URL(uri);
    if ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.pathname.endsWith(".torrent")) {
      return;
    }
  } catch {
    // Local paths are accepted only when they end in .torrent, handled above.
  }

  throw new Error("Torrent URI must be a magnet link, a .torrent URL, or a local .torrent path.");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildPreviewCommand(uri: string, outputDirectory: string, seedTimeMinutes: number): string {
  return [
    "aria2c",
    "--dir",
    shellQuote(outputDirectory),
    "--seed-time",
    String(seedTimeMinutes),
    "--summary-interval=30",
    "--console-log-level=notice",
    shellQuote(uri)
  ].join(" ");
}

async function runAria2c(
  uri: string,
  outputDirectory: string,
  seedTimeMinutes: number,
  timeoutMinutes: number,
  signal?: AbortSignal
): Promise<DownloadTorrentResult> {
  const args = [
    "--dir",
    outputDirectory,
    "--seed-time",
    String(seedTimeMinutes),
    "--summary-interval=30",
    "--console-log-level=notice",
    uri
  ];

  const child = spawn("aria2c", args, {
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
  }, timeoutMinutes * 60 * 1000);

  const abort = () => child.kill("SIGTERM");
  signal?.addEventListener("abort", abort, { once: true });

  return await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = truncateOutput(stdout + chunk.toString("utf8"));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = truncateOutput(stderr + chunk.toString("utf8"));
    });

    child.on("error", reject);

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      resolve({ uri, outputDirectory, exitCode, stdout, stderr, timedOut });
    });
  });
}

function formatResult(result: DownloadTorrentResult): string {
  return [
    "Torrent download finished.",
    `URI: ${result.uri}`,
    `Output directory: ${result.outputDirectory}`,
    `Exit code: ${result.exitCode ?? "unknown"}${result.timedOut ? " (timed out)" : ""}`,
    "",
    "stdout:",
    result.stdout || "(empty)",
    "",
    "stderr:",
    result.stderr || "(empty)"
  ].join("\n");
}

export function createDownloadTorrentTool(state: SessionToolState): AgentTool {
  return {
    name: "download_torrent",
    label: "Download torrent",
    description:
      "Download a user-provided magnet link or .torrent file using aria2c after explicit user approval. Only use for content the user has rights to download.",
    parameters: downloadTorrentSchema,
    execute: async (_toolCallId, params, signal) => {
      const input = params as DownloadTorrentParams;
      validateTorrentUri(input.uri);

      const outputDirectory = input.outputDirectory
        ? resolveFromCwd(state.cwd, input.outputDirectory)
        : "/home/koushikk/MANGA";
      const seedTimeMinutes = Math.max(0, Math.min(input.seedTimeMinutes ?? 0, 10_080));
      const timeoutMinutes = Math.max(1, Math.min(input.timeoutMinutes ?? 120, 1_440));
      const preview = buildPreviewCommand(input.uri, outputDirectory, seedTimeMinutes);

      const approved = await requestCommandApproval(state.chatId, preview, state.cwd);
      if (!approved) {
        return textResult(`User denied torrent download: ${input.uri}`);
      }

      await mkdir(outputDirectory, { recursive: true });
      const result = await runAria2c(input.uri, outputDirectory, seedTimeMinutes, timeoutMinutes, signal);

      return {
        ...textResult(formatResult(result)),
        details: result
      };
    },
    executionMode: "sequential"
  };
}

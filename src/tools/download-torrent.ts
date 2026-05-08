import { mkdir } from "node:fs/promises";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { requestCommandApproval } from "../approvals.js";
import { formatProcessResult, runProcess, type ProcessResult } from "../process.js";
import { defineTool, resolveFromCwd, textResult, type SessionToolState } from "./shared.js";

export const defaultTorrentDownloadDirectory = "/home/koushik/MANGA";

const DEFAULT_TIMEOUT_MINUTES = 120;
const MAX_TIMEOUT_MINUTES = 1_440;
const MAX_SEED_TIME_MINUTES = 10_080;

const ARIA2C_FLAGS = ["--summary-interval=30", "--console-log-level=notice"] as const;

const downloadTorrentSchema = Type.Object({
  uri: Type.String({
    description: "Magnet URI, local .torrent path, or http(s) URL to a .torrent file. Only use for content the user has rights to download."
  }),
  outputDirectory: Type.Optional(Type.String({
    description: `Directory to save files into. Relative paths are resolved against the current agent directory. Defaults to ${defaultTorrentDownloadDirectory}.`
  })),
  seedTimeMinutes: Type.Optional(Type.Number({
    description: "How long aria2c should seed after the download completes. Defaults to 0."
  })),
  timeoutMinutes: Type.Optional(Type.Number({
    description: `Maximum time to let aria2c run. Defaults to ${DEFAULT_TIMEOUT_MINUTES} minutes and is capped at ${MAX_TIMEOUT_MINUTES} minutes.`
  }))
});

export type DownloadTorrentResult = ProcessResult & {
  uri: string;
  outputDirectory: string;
};

type DownloadTorrentDetails =
  | ({ kind: "downloaded" } & DownloadTorrentResult)
  | { kind: "denied"; uri: string };

export function validateTorrentUri(uri: string): void {
  if (uri.startsWith("magnet:?xt=urn:btih:")) return;
  if (uri.endsWith(".torrent")) return;

  try {
    const parsed = new URL(uri);
    const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
    if (isHttp && parsed.pathname.endsWith(".torrent")) return;
  } catch {
    // Not a URL: fall through. Local paths must end in .torrent (handled above).
  }

  throw new Error("Torrent URI must be a magnet link, a .torrent URL, or a local .torrent path.");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildAria2Args(uri: string, outputDirectory: string, seedTimeMinutes: number): string[] {
  return [
    "--dir", outputDirectory,
    "--seed-time", String(seedTimeMinutes),
    ...ARIA2C_FLAGS,
    uri
  ];
}

function buildAria2Preview(uri: string, outputDirectory: string, seedTimeMinutes: number): string {
  return [
    "aria2c",
    "--dir", shellQuote(outputDirectory),
    "--seed-time", String(seedTimeMinutes),
    ...ARIA2C_FLAGS,
    shellQuote(uri)
  ].join(" ");
}

function resolveOutputDirectory(input: string | undefined, cwd: string): string {
  return input ? resolveFromCwd(cwd, input) : defaultTorrentDownloadDirectory;
}

type DownloadTorrentInput = {
  uri: string;
  outputDirectory?: string;
  seedTimeMinutes?: number;
  timeoutMinutes?: number;
  cwd?: string;
  signal?: AbortSignal;
};

export async function downloadTorrent(input: DownloadTorrentInput): Promise<DownloadTorrentResult> {
  validateTorrentUri(input.uri);

  const outputDirectory = resolveOutputDirectory(input.outputDirectory, input.cwd ?? process.cwd());
  const seedTimeMinutes = clamp(input.seedTimeMinutes ?? 0, 0, MAX_SEED_TIME_MINUTES);
  const timeoutMinutes = clamp(input.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES, 1, MAX_TIMEOUT_MINUTES);

  await mkdir(outputDirectory, { recursive: true });

  const processResult = await runProcess(
    "aria2c",
    buildAria2Args(input.uri, outputDirectory, seedTimeMinutes),
    {
      timeoutMs: timeoutMinutes * 60 * 1000,
      signal: input.signal
    }
  );

  return { ...processResult, uri: input.uri, outputDirectory };
}

export function formatDownloadTorrentResult(result: DownloadTorrentResult): string {
  return formatProcessResult(result, [
    "Torrent download finished.",
    `URI: ${result.uri}`,
    `Output directory: ${result.outputDirectory}`
  ]);
}

export function createDownloadTorrentTool(state: SessionToolState): AgentTool {
  return defineTool({
    name: "download_torrent",
    label: "Download torrent",
    description:
      "Download a user-provided magnet link or .torrent file using aria2c after explicit user approval. Only use for content the user has rights to download.",
    parameters: downloadTorrentSchema,
    executionMode: "sequential",
    execute: async (params, { signal }) => {
      validateTorrentUri(params.uri);

      const outputDirectory = resolveOutputDirectory(params.outputDirectory, state.cwd);
      const seedTimeMinutes = clamp(params.seedTimeMinutes ?? 0, 0, MAX_SEED_TIME_MINUTES);
      const timeoutMinutes = clamp(params.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES, 1, MAX_TIMEOUT_MINUTES);
      const preview = buildAria2Preview(params.uri, outputDirectory, seedTimeMinutes);

      const approved = await requestCommandApproval(state.chatId, preview, state.cwd);
      if (!approved) {
        return textResult<DownloadTorrentDetails>(
          `User denied torrent download: ${params.uri}`,
          { kind: "denied", uri: params.uri }
        );
      }

      const result = await downloadTorrent({
        uri: params.uri,
        outputDirectory: params.outputDirectory,
        seedTimeMinutes,
        timeoutMinutes,
        cwd: state.cwd,
        signal
      });

      return textResult<DownloadTorrentDetails>(
        formatDownloadTorrentResult(result),
        { kind: "downloaded", ...result }
      );
    }
  });
}

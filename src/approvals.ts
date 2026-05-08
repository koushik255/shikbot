/**
 * Per-chat approval flow used by the `execute_command` and `download_torrent`
 * tools. The agent calls `requestCommandApproval` and awaits a yes/no decision
 * delivered by the Telegram side via `resolveApprovalFromText`.
 */

export type ApprovalDecision = "approved" | "denied";

type PendingApproval = {
  id: string;
  command: string;
  cwd: string;
  resolve: (approved: boolean) => void;
  timeout: NodeJS.Timeout;
};

/** Sends the approval prompt to the user (typically via Telegram). */
type AppovalNotifier = (
  chatId: number,
  message: string,
) => Promise<void> | void;

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const YES_INPUTS = new Set(["yes", "y", "/yes"]);
const NO_INPUTS = new Set(["no", "n", "/no"]);

const pendingByChatId = new Map<number, PendingApproval>();
let notifier: ApprovalNotifier | undefined;
let nextApprovalId = 1;

export function setApprovalNotifier(next: ApprovalNotifier): void {
  notifier = next;
}

/**
 * Request approval for `command` from the user owning `chatId`.
 *
 * Resolves to `true` when the user approves, `false` on denial or timeout.
 * Any previously pending approval for the same chat is treated as denied.
 */
export function requestCommandApproval(
  chatId: number,
  command: string,
  cwd: string,
): Promise<boolean> {
  resolvePending(chatId, false);

  const id = String(nextApprovalId++);
  const { promise, resolve } = Promise.withResolvers<boolean>();

  const timeout = setTimeout(() => {
    pendingByChatId.delete(chatId);
    resolve(false);
  }, APPROVAL_TIMEOUT_MS);

  pendingByChatId.set(chatId, { id, command, cwd, resolve, timeout });
  void notifier?.(chatId, buildApprovalMessage(id, command, cwd));

  return promise;
}

/**
 * Apply a yes/no `text` from the user to the chat's pending approval.
 *
 * Returns `undefined` if the text isn't a yes/no answer, or if there is no
 * pending approval for the chat.
 */
export function resolveApprovalFromText(
  chatId: number,
  text: string,
): ApprovalDecision | undefined {
  const decision = parseDecision(text);
  if (!decision) return undefined;
  if (!pendingByChatId.has(chatId)) return undefined;

  resolvePending(chatId, decision === "approved");
  return decision;
}

export function hasPendingApproval(chatId: number): boolean {
  return pendingByChatId.has(chatId);
}

function parseDecision(text: string): ApprovalDecision | undefined {
  const normalized = text.trim().toLowerCase();
  if (YES_INPUTS.has(normalized)) return "approved";
  if (NO_INPUTS.has(normalized)) return "denied";
  return undefined;
}

function resolvePending(chatId: number, approved: boolean): void {
  const pending = pendingByChatId.get(chatId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingByChatId.delete(chatId);
  pending.resolve(approved);
}

function buildApprovalMessage(
  id: string,
  command: string,
  cwd: string,
): string {
  return [
    "Command approval requested:",
    "",
    `ID: ${id}`,
    `Directory: ${cwd}`,
    "Command:",
    "```",
    command,
    "```",
    "",
    "Reply `yes` to approve or `no` to deny. You can also use /yes or /no.",
  ].join("\n");
}

export type ApprovalDecision = "approved" | "denied";

type PendingApproval = {
  id: string;
  chatId: number;
  command: string;
  cwd: string;
  resolve: (approved: boolean) => void;
  timeout: NodeJS.Timeout;
};

type ApprovalNotifier = (chatId: number, message: string) => Promise<void> | void;

const pendingByChat = new Map<number, PendingApproval>();
let notifier: ApprovalNotifier | undefined;
let nextApprovalId = 1;

export function setApprovalNotifier(nextNotifier: ApprovalNotifier): void {
  notifier = nextNotifier;
}

export async function requestCommandApproval(chatId: number, command: string, cwd: string): Promise<boolean> {
  const existing = pendingByChat.get(chatId);
  if (existing) {
    existing.resolve(false);
    clearTimeout(existing.timeout);
    pendingByChat.delete(chatId);
  }

  const id = String(nextApprovalId++);

  return await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pendingByChat.delete(chatId);
      resolve(false);
    }, 5 * 60 * 1000);

    const pending: PendingApproval = { id, chatId, command, cwd, resolve, timeout };
    pendingByChat.set(chatId, pending);

    const message = [
      "Command approval requested:",
      "",
      `ID: ${id}`,
      `Directory: ${cwd}`,
      "Command:",
      "```",
      command,
      "```",
      "",
      "Reply `yes` to approve or `no` to deny. You can also use /yes or /no."
    ].join("\n");

    void notifier?.(chatId, message);
  });
}

export function resolveApprovalFromText(chatId: number, text: string): ApprovalDecision | undefined {
  const normalized = text.trim().toLowerCase();
  const isYes = normalized === "yes" || normalized === "y" || normalized === "/yes";
  const isNo = normalized === "no" || normalized === "n" || normalized === "/no";

  if (!isYes && !isNo) {
    return undefined;
  }

  const pending = pendingByChat.get(chatId);
  if (!pending) {
    return undefined;
  }

  clearTimeout(pending.timeout);
  pendingByChat.delete(chatId);
  pending.resolve(isYes);
  return isYes ? "approved" : "denied";
}

export function hasPendingApproval(chatId: number): boolean {
  return pendingByChat.has(chatId);
}

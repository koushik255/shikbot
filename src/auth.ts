import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { getEnvApiKey } from "@mariozechner/pi-ai";
import { getOAuthApiKey, type OAuthCredentials } from "@mariozechner/pi-ai/oauth";

export type AuthFile = Record<string, OAuthCredentials & { type?: "oauth" }>;

export const authPath = resolve(process.env.PI_AUTH_FILE ?? ".pi-auth.json");

export function loadAuth(): AuthFile {
  if (!existsSync(authPath)) {
    return {};
  }

  return JSON.parse(readFileSync(authPath, "utf8")) as AuthFile;
}

export function saveAuth(auth: AuthFile): void {
  mkdirSync(dirname(authPath), { recursive: true });
  writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
}

export async function getProviderApiKey(provider: string): Promise<string | undefined> {
  const envKey = getEnvApiKey(provider);
  if (envKey) {
    return envKey;
  }

  try {
    const auth = loadAuth();
    const result = await getOAuthApiKey(provider, auth);

    if (!result) {
      return undefined;
    }

    auth[provider] = {
      type: "oauth",
      ...result.newCredentials
    };
    saveAuth(auth);

    return result.apiKey;
  } catch (error) {
    console.error(`Failed to load OAuth credentials for ${provider}:`, error);
    return undefined;
  }
}

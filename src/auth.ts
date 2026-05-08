import { resolve } from "node:path";
import { getEnvApiKey } from "@earendil-works/pi-ai";
import { getOAuthApiKey, type OAuthCredentials } from "@earendil-works/pi-ai/oauth";
import { createJsonStore } from "./json-store.js";

export type AuthFile = Record<string, OAuthCredentials & { type?: "oauth" }>;

export const authPath = resolve(process.env["PI_AUTH_FILE"] ?? ".pi-auth.json");

const authStore = createJsonStore<AuthFile>({
  path: authPath,
  defaults: () => ({})
});

export function loadAuth(): AuthFile {
  return authStore.load();
}

export function saveAuth(auth: AuthFile): void {
  authStore.save(auth);
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

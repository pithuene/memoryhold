import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getOAuthApiKey, getOAuthProvider, type OAuthCredentials } from "@earendil-works/pi-ai/oauth";
import { getEnvApiKey } from "@earendil-works/pi-ai";

type AuthFile = Record<string, { type: "oauth" } & OAuthCredentials>;

export class AuthStore {
  private readonly filePath: string;

  constructor(rootDir: string) {
    this.filePath = join(rootDir, "auth.json");
  }

  async load(): Promise<AuthFile> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as AuthFile;
    } catch {
      return {};
    }
  }

  async save(auth: AuthFile): Promise<void> {
    await writeFile(this.filePath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  }

  async setOAuth(providerId: string, credentials: OAuthCredentials): Promise<void> {
    const auth = await this.load();
    auth[providerId] = { type: "oauth", ...credentials };
    await this.save(auth);
  }

  async getApiKey(providerId: string): Promise<string | undefined> {
    const envKey = getEnvApiKey(providerId as any);
    if (envKey) return envKey;

    const provider = getOAuthProvider(providerId);
    if (!provider) return undefined;
    const auth = await this.load();
    const oauthCredentials: Record<string, OAuthCredentials> = Object.fromEntries(
      Object.entries(auth).map(([id, value]) => {
        const { type: _type, ...credentials } = value;
        return [id, credentials as OAuthCredentials];
      }),
    );
    const result = await getOAuthApiKey(providerId, oauthCredentials);
    if (!result) return undefined;
    auth[providerId] = { type: "oauth", ...result.newCredentials };
    await this.save(auth);
    return result.apiKey;
  }

  async listStatus(): Promise<Array<{ id: string; name: string; authenticated: boolean }>> {
    const auth = await this.load();
    return ["openai-codex", "anthropic", "github-copilot"].map((id) => {
      const provider = getOAuthProvider(id);
      return { id, name: provider?.name ?? id, authenticated: Boolean(auth[id]) };
    });
  }
}

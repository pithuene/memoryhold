import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { getOAuthProvider } from "@earendil-works/pi-ai/oauth";
import { AuthStore } from "./auth-store.js";

type PendingLogin = {
  providerId: string;
  status: "starting" | "waiting" | "done" | "error";
  authUrl?: string;
  instructions?: string;
  error?: string;
  resolveManual?: (value: string) => void;
  rejectManual?: (error: Error) => void;
};

const pending = new Map<string, PendingLogin>();

export function createOAuthRoutes(authStore: AuthStore): Hono {
  const app = new Hono();

  app.get("/providers", async (c) => c.json(await authStore.listStatus()));

  app.post("/:providerId/start", async (c) => {
    const providerId = c.req.param("providerId");
    const provider = getOAuthProvider(providerId);
    if (!provider) return c.json({ error: `Unknown OAuth provider: ${providerId}` }, 404);

    const loginId = randomUUID();
    const state: PendingLogin = { providerId, status: "starting" };
    pending.set(loginId, state);

    void provider.login({
      onAuth(info) {
        state.status = "waiting";
        state.authUrl = info.url;
        state.instructions = info.instructions;
      },
      onPrompt: async (prompt) => {
        state.status = "waiting";
        state.instructions = prompt.message;
        return new Promise<string>((resolve, reject) => {
          state.resolveManual = resolve;
          state.rejectManual = reject;
        });
      },
      onManualCodeInput: async () => {
        return new Promise<string>((resolve, reject) => {
          state.resolveManual = resolve;
          state.rejectManual = reject;
        });
      },
      onProgress(message) {
        state.instructions = message;
      },
    }).then(async (credentials) => {
      await authStore.setOAuth(providerId, credentials);
      state.status = "done";
    }).catch((error) => {
      state.status = "error";
      state.error = error instanceof Error ? error.message : String(error);
    });

    for (let i = 0; i < 50 && !state.authUrl && state.status !== "error"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return c.json({ loginId, providerId, status: state.status, authUrl: state.authUrl, instructions: state.instructions, error: state.error });
  });

  app.get("/:loginId/status", (c) => {
    const state = pending.get(c.req.param("loginId"));
    if (!state) return c.json({ error: "Unknown login" }, 404);
    return c.json({ providerId: state.providerId, status: state.status, authUrl: state.authUrl, instructions: state.instructions, error: state.error });
  });

  app.post("/:loginId/complete", async (c) => {
    const state = pending.get(c.req.param("loginId"));
    if (!state) return c.json({ error: "Unknown login" }, 404);
    const body = await c.req.json();
    const code = String(body.code ?? "");
    if (!code.trim()) return c.json({ error: "Missing code or redirect URL" }, 400);
    state.resolveManual?.(code);
    return c.json({ ok: true });
  });

  return app;
}

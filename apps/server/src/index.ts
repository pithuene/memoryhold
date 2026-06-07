import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  getModels,
  getProviders,
  getSupportedThinkingLevels,
} from "@earendil-works/pi-ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { existsSync } from "node:fs";
import type { SendMessageRequest } from "@memoryhold/shared";
import { SessionRepo } from "./session-repo.js";
import { AuthStore } from "./auth-store.js";
import { EventHub } from "./events.js";
import { createOAuthRoutes } from "./oauth-routes.js";
import { SessionRunner } from "./session-runner.js";
import { fetchWebPage, searchWeb } from "./web-tools.js";

const conversationsDir = process.env.CONVERSATIONS_DIR;
if (!conversationsDir) {
  console.error("Missing required env var: CONVERSATIONS_DIR");
  process.exit(1);
}

const repo = new SessionRepo(conversationsDir);
const authStore = new AuthStore(conversationsDir);
const events = new EventHub();
const runner = new SessionRunner(repo, events, authStore);
const app = new Hono();
const accessToken =
  process.env.MEMORYHOLD_ACCESS_TOKEN ?? process.env.MEMORYHOLD_TOKEN ?? "";
const allowedOrigins = (process.env.MEMORYHOLD_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  "*",
  cors({
    origin: allowedOrigins.length
      ? (origin) => (allowedOrigins.includes(origin) ? origin : "")
      : "*",
    allowHeaders: ["Content-Type", "Authorization", "X-Memoryhold-Token"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/api/health", (c) =>
  c.json({ ok: true, authRequired: Boolean(accessToken) }),
);

app.use("/api/*", async (c, next) => {
  if (!accessToken || c.req.path === "/api/health") return next();
  const auth = c.req.header("Authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  const token =
    bearer ??
    c.req.header("X-Memoryhold-Token") ??
    c.req.query("access_token") ??
    "";
  if (token !== accessToken)
    return c.text(
      "Unauthorized: invalid or missing Memoryhold access token",
      401,
    );
  return next();
});

app.route("/api/oauth", createOAuthRoutes(authStore));

app.get("/api/providers", (c) => {
  const providers = getProviders().map((provider) => ({
    id: provider,
    models: getModels(provider).map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      contextWindow: model.contextWindow,
      supportedThinkingLevels: getSupportedThinkingLevels(model),
    })),
  }));
  return c.json(providers);
});

app.get("/api/sessions", async (c) => c.json(await repo.list()));

app.post("/api/sessions", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const metadata = await repo.create(body);
  return c.json(metadata, 201);
});

app.get("/api/sessions/:slug", async (c) =>
  c.json(await repo.get(c.req.param("slug"))),
);

app.patch("/api/sessions/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (runner.isStreaming(slug))
    return c.text("Cannot rename while a response is streaming", 409);
  const body = await c.req.json().catch(() => ({}));
  const metadata = await repo.rename(slug, String(body.title ?? ""));
  runner.reset(slug);
  events.publish(slug, { type: "session_updated", metadata });
  if (metadata.slug !== slug)
    events.publish(metadata.slug, { type: "session_updated", metadata });
  return c.json(metadata);
});

app.delete("/api/sessions/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (runner.isStreaming(slug))
    return c.text("Cannot delete while a response is streaming", 409);
  runner.reset(slug);
  await repo.delete(slug);
  events.publish(slug, { type: "session_deleted", slug });
  return c.json({ ok: true });
});

app.post("/api/sessions/:slug/attachments", async (c) => {
  const slug = c.req.param("slug");
  const form = await c.req.formData();
  const files = form
    .getAll("files")
    .filter((value): value is File => value instanceof File);
  const attachments = [];
  for (const file of files)
    attachments.push(await repo.saveAttachment(slug, file));
  return c.json({ attachments });
});

app.get("/api/sessions/:slug/attachments/:filename", async (c) => {
  const bytes = await repo.readAttachment(
    c.req.param("slug"),
    `attachments/${c.req.param("filename")}`,
  );
  return new Response(new Uint8Array(bytes));
});

app.post("/api/sessions/:slug/messages", async (c) => {
  const slug = c.req.param("slug");
  const body = (await c.req.json()) as SendMessageRequest;
  const result = await runner.enqueueUserMessage(
    slug,
    body.content,
    body.attachments ?? [],
    {
      model: body.model,
      thinkingLevel: body.thinkingLevel,
    },
  );
  return c.json({ ok: true, ...result });
});

app.patch("/api/sessions/:slug/messages/:entryId", async (c) => {
  const slug = c.req.param("slug");
  if (runner.isStreaming(slug))
    return c.text("Cannot edit while a response is streaming", 409);
  const body = (await c.req.json()) as SendMessageRequest;
  const attachments = await repo.truncateBeforeMessage(
    slug,
    c.req.param("entryId"),
  );
  runner.reset(slug);
  const { metadata } = await repo.get(slug);
  events.publish(slug, { type: "session_updated", metadata });
  const result = await runner.enqueueUserMessage(
    slug,
    body.content,
    attachments,
    {
      model: body.model,
      thinkingLevel: body.thinkingLevel,
    },
  );
  return c.json({ ok: true, ...result });
});

app.get("/api/sessions/:slug/events", (c) => {
  const slug = c.req.param("slug");
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      send({ type: "connected" });
      const unsubscribe = events.subscribe(slug, send as any);
      c.req.raw.signal.addEventListener("abort", () => {
        unsubscribe();
        controller.close();
      });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

const webDistDir = process.env.MEMORYHOLD_WEB_DIST;
if (webDistDir && existsSync(webDistDir)) {
  app.use("/assets/*", serveStatic({ root: webDistDir }));
  app.use("/favicon.ico", serveStatic({ root: webDistDir }));
  app.get("*", serveStatic({ path: `${webDistDir}/index.html` }));
}

app.post("/api/tools/web-search", async (c) => {
  const { query, numResults } = await c.req.json();
  return c.json({
    query,
    results: await searchWeb(String(query ?? ""), Number(numResults ?? 5)),
  });
});

app.post("/api/tools/web-fetch", async (c) => {
  const { url } = await c.req.json();
  return c.json(await fetchWebPage(String(url ?? "")));
});

const port = Number(process.env.PORT ?? 8787);
await repo.ensureRoot();
serve({ fetch: app.fetch, port });
console.log(`Memoryhold server listening on http://localhost:${port}`);
console.log(`Conversations dir: ${conversationsDir}`);

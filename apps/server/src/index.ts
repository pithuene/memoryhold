import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { SendMessageRequest } from "@memoryhold/shared";
import { SessionRepo } from "./session-repo.js";
import { EventHub } from "./events.js";
import { SessionRunner } from "./session-runner.js";

const conversationsDir = process.env.CONVERSATIONS_DIR;
if (!conversationsDir) {
  console.error("Missing required env var: CONVERSATIONS_DIR");
  process.exit(1);
}

const repo = new SessionRepo(conversationsDir);
const events = new EventHub();
const runner = new SessionRunner(repo, events);
const app = new Hono();

app.use("*", cors());

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/sessions", async (c) => c.json(await repo.list()));

app.post("/api/sessions", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const metadata = await repo.create(body);
  return c.json(metadata, 201);
});

app.get("/api/sessions/:slug", async (c) => c.json(await repo.get(c.req.param("slug"))));

app.post("/api/sessions/:slug/attachments", async (c) => {
  const slug = c.req.param("slug");
  const form = await c.req.formData();
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  const attachments = [];
  for (const file of files) attachments.push(await repo.saveAttachment(slug, file));
  return c.json({ attachments });
});

app.post("/api/sessions/:slug/messages", async (c) => {
  const slug = c.req.param("slug");
  const body = (await c.req.json()) as SendMessageRequest;
  const entry = await runner.enqueueUserMessage(slug, body.content, body.attachments ?? []);
  return c.json({ ok: true, entry });
});

app.get("/api/sessions/:slug/events", (c) => {
  const slug = c.req.param("slug");
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
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

app.post("/api/tools/web-search", async (c) => {
  const { query } = await c.req.json();
  return c.json({ query, results: [], note: "web_search tool stub; provider implementation pending" });
});

const port = Number(process.env.PORT ?? 8787);
await repo.ensureRoot();
serve({ fetch: app.fetch, port });
console.log(`Memoryhold server listening on http://localhost:${port}`);
console.log(`Conversations dir: ${conversationsDir}`);

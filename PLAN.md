# Memoryhold Plan

Memoryhold is a local-first, server-backed AI chat app inspired by the ChatGPT web interface. Its main purpose is to keep valuable AI conversations under local user control instead of siloed in hosted services.

## Goals

- ChatGPT-like web interface with multiple conversations.
- Conversations stored locally on the backend filesystem.
- Use `@earendil-works/pi-*` packages, especially `pi-web-ui`, where practical.
- Support any provider/model supported by pi, with OpenAI Codex OAuth/subscription login as the first must-work provider.
- Backend-owned agent execution and backend-owned tool execution.
- Browser-only v1; architecture should allow Electron/Capacitor later.
- No app-level auth for v1; assumed VPN-only access.

## Architecture

```text
apps/
  web/       Vite frontend, Lit/custom elements, pi-web-ui components
  server/    Hono backend, Node/TypeScript
packages/
  shared/    shared types and schemas
```

### Frontend

- Browser UI using Vite + Lit/custom elements.
- Reuse pi-web-ui components as much as feasible, but backend owns execution.
- Talks to backend over HTTP + SSE.
- Displays sessions, active conversation, model/thinking controls, input, attachments.

### Backend

- Node/TypeScript + Hono.
- Owns sessions, model calls, provider credentials, OAuth, tools, storage.
- Stores conversations in a mandatory `CONVERSATIONS_DIR`.
- Fails to start if `CONVERSATIONS_DIR` is missing.
- Supports multiple sessions concurrently.
- One active generation per session.
- If a client sends while a session is streaming, queue/steer via pi's queued-message steering.

## Storage

Each conversation is a directory:

```text
CONVERSATIONS_DIR/
  2026-05-10-my-chat-title/
    session.jsonl
    metadata.json
    attachments/
      <attachment-id>-file.ext
```

### Canonical transcript

Use a pi-compatible JSONL session format where possible:

- first line: session header
- following lines: append-only `SessionTreeEntry` records
- entries use `id`, `parentId`, `timestamp`
- message entries store pi `AgentMessage`
- model/thinking changes are timeline entries, matching pi behavior
- branching is supported by storage from the start
- v1 UI only continues from current leaf; branch editing/regeneration UI later

### Metadata

`metadata.json` is mutable and may be rewritten in place.

Typical fields:

- id
- title
- createdAt
- lastModified
- messageCount
- currentLeafId
- preview

Metadata can be regenerated from `session.jsonl` if needed.

## Attachments

- v1 supports images and files.
- Uploaded attachments are copied into the conversation directory under `attachments/`.
- Messages reference attachments by relative path so conversations are self-contained.

## Provider credentials and OAuth

- Credentials live on the backend.
- v1 needs a simple UI for provider setup/OAuth.
- OpenAI Codex OAuth/subscription login is the first acceptance target.
- UI can be basic: start login, open auth URL, paste callback URL/token if needed.
- Reuse pi's existing auth/OAuth functions where possible.

## Streaming / multi-client

Use HTTP + SSE:

```text
GET  /api/sessions
POST /api/sessions
GET  /api/sessions/:id
POST /api/sessions/:id/messages
GET  /api/sessions/:id/events
```

Rules:

- multiple tabs/devices can watch the same session
- backend broadcasts events to subscribers
- one active generation per session
- incoming messages during streaming are queued and routed through pi steering

## Tools

- Tool calls execute on the backend.
- Web search tool interface exists in v1.
- Initial implementation may be a mock/stub.
- Later search provider fallback order desired:
  1. Codex web search if available
  2. Exa MCP
  3. DuckDuckGo scraping fallback, like pi web search extension

Future tools may include local filesystem/wiki/notebook tools.

## Out of scope for v1

- Full branch navigation/edit/regenerate UI.
- Search across conversations.
- Artifacts panel/tool support.
- ChatGPT import.
- Extra backup/versioning beyond append-only JSONL.
- App-level auth.
- Electron/Capacitor wrappers.

## Initial implementation steps

1. Scaffold pnpm monorepo.
2. Add shared TypeScript types for sessions, metadata, SSE events.
3. Add Hono backend with required `CONVERSATIONS_DIR` validation.
4. Implement filesystem session repository using `session.jsonl` + `metadata.json`.
5. Add basic API endpoints for session list/create/load/message.
6. Add SSE event hub.
7. Add Vite frontend shell.
8. Wire simple session list and chat panel to backend.
9. Integrate pi agent execution on backend.
10. Add provider credential/OAuth UI, starting with OpenAI Codex.
11. Add backend web search tool stub.

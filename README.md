# Memoryhold

Memoryhold is a local-first ChatGPT-like desktop/web app for private AI conversations. It stores chats, metadata, and attachments on your filesystem, while using a local backend to run models and tools through [`pi`](https://github.com/earendil-works/pi) packages.

> Status: early developer preview. The app works locally, but packaged builds are currently unsigned/unnotarized.

## Highlights

- **Local-first storage** — conversations live in a folder you choose.
- **Durable chat URLs** — reload or link directly to `/c/<chat-slug>`.
- **Desktop app** — Electron wrapper with first-launch conversation-folder picker.
- **Real backend execution** — model calls, tools, credentials, and OAuth happen server-side.
- **Provider support via pi** — including OpenAI Codex OAuth/subscription login.
- **Attachments** — text/PDF extraction and real image input blocks for supported models.
- **Web tools** — `web_search` and `web_fetch` using Exa when available, public Exa MCP fallback, and DuckDuckGo/local fetch fallbacks.
- **Modern chat UI** — React + Radix/shadcn-style foundation, markdown, TeX, editing/rerun, rename/delete, and streaming.

## Repository layout

```text
apps/
  server/     Hono backend, filesystem storage, pi agent runner, OAuth, tools
  web/        React/Vite chat UI
  electron/   Desktop wrapper and macOS packaging scripts
packages/
  shared/     Shared TypeScript types
scripts/      Local screenshot/reference helpers
```

## Requirements

- Node.js 22+
- pnpm
- macOS for the current desktop packaging flow

Enable pnpm through Corepack if needed:

```bash
corepack enable
corepack prepare pnpm@10.19.0 --activate
```

## Quick start: browser dev mode

```bash
git clone git@github.com:pithuene/memoryhold.git
cd memoryhold
pnpm install
mkdir -p ~/Memoryhold-Conversations
CONVERSATIONS_DIR=~/Memoryhold-Conversations pnpm --filter @memoryhold/server dev
```

In another terminal:

```bash
pnpm --filter @memoryhold/web dev
```

Open the Vite URL printed by the web dev server, usually `http://localhost:5173`.

The backend intentionally refuses to start unless `CONVERSATIONS_DIR` is set.

## Desktop dev mode

```bash
pnpm electron:dev
```

On first launch, Memoryhold asks you to choose a conversations folder. That folder is persisted in Electron app data and can be changed from **File → Open Folder…**.

Note: raw Electron dev mode may still appear as “Electron” in the macOS Dock/menu bar. The packaged `.app` uses the Memoryhold app identity.

## Package the macOS app

```bash
pnpm package:mac
open release/Memoryhold-darwin-*/Memoryhold.app
```

The packaged app is currently unsigned and unnotarized, so macOS may require right-click → **Open** the first time.

GitHub Actions also includes a manual/tag-triggered macOS artifact workflow at `.github/workflows/release-mac.yml`.

## Credentials and privacy

Memoryhold does not require app-level cloud storage. Your conversations and credentials stay in the local conversations folder you select.

Stored files include:

```text
<CONVERSATIONS_DIR>/
  auth.json                         OAuth credentials, chmod 600
  <chat-slug>/
    metadata.json                   mutable title/timestamps
    session.jsonl                   pi-compatible transcript
    attachments/                    uploaded files copied into the chat folder
```

Important:

- Do **not** commit your conversations folder.
- Do **not** commit `auth.json`, `.env`, logs, `tmp/`, or packaged `release/` outputs.
- `.gitignore` already excludes common local/runtime outputs.
- Provider API keys should be passed through environment variables or OAuth, not hard-coded.

### Optional environment variables

```bash
# Required for server dev mode
CONVERSATIONS_DIR=/absolute/path/to/conversations

# Optional direct Exa API. Without this, Memoryhold tries Exa public MCP, then DuckDuckGo.
EXA_API_KEY=...

# Optional override for Exa MCP endpoint
EXA_MCP_URL=https://mcp.exa.ai/mcp
```

## Development commands

```bash
pnpm check          # type-check all workspaces
pnpm build          # build all workspaces
pnpm electron:dev   # run desktop dev wrapper
pnpm package:mac    # build unsigned macOS .app
pnpm screenshot     # local Playwright screenshot helper
```

## Current limitations

- Scanned/image-only PDFs need OCR and are not yet understood.
- Only one active generation is allowed per conversation; additional messages are steered/queued by the backend.
- The packaged macOS app is unsigned/unnotarized.
- No app-level authentication is included; run it locally or behind trusted network boundaries.

## Security review before publishing

Before making a release or pushing from a dev machine, run:

```bash
git status --short
git grep -n -E '(api[_-]?key|secret|token|password|auth\.json|sk-|ghp_|github_pat_|BEGIN (RSA|OPENSSH|PRIVATE))' -- . ':!pnpm-lock.yaml'
```

This repository should not contain real provider credentials or conversation data.

## License

No open-source license has been selected yet.

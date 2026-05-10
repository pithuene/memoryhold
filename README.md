# Memoryhold

Local filesystem-backed AI conversations, using pi packages where practical.

## Setup

```bash
pnpm install
CONVERSATIONS_DIR=/absolute/path/to/conversations pnpm --filter @memoryhold/server dev
pnpm --filter @memoryhold/web dev
```

The server refuses to start unless `CONVERSATIONS_DIR` is set.

## Electron desktop dev

```bash
pnpm electron:dev
```

On first launch, the desktop app asks you to choose a conversations folder. It stores that choice in Electron app data and then starts the local backend and web UI for you.

## Package macOS app

```bash
pnpm package:mac
open release/Memoryhold-darwin-*/Memoryhold.app
```

The packaged app is unsigned for now. macOS may require right-click → Open the first time.

See [PLAN.md](./PLAN.md) for the project plan.

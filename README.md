# Memoryhold

Local filesystem-backed AI conversations, using pi packages where practical.

## Setup

```bash
pnpm install
CONVERSATIONS_DIR=/absolute/path/to/conversations pnpm --filter @memoryhold/server dev
pnpm --filter @memoryhold/web dev
```

The server refuses to start unless `CONVERSATIONS_DIR` is set.

See [PLAN.md](./PLAN.md) for the project plan.

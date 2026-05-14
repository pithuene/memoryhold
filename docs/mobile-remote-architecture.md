# Mobile and Remote Architecture

Memoryhold now supports three client/runtime modes:

1. **Browser web client** — the Vite/React UI connects to a configured Memoryhold HTTP/SSE server.
2. **Electron desktop** — defaults to local-first mode by launching the Node/Hono backend with a chosen conversations folder, but can also run as a remote client against an existing server.
3. **Capacitor Android** — wraps the shared web UI and connects to a configured Memoryhold server. It does not run the Node backend on-device.

## Compatibility boundaries

### Shared/platform-neutral code

These pieces should remain browser-compatible and free of Node/Electron/Capacitor-only imports unless explicitly isolated:

- shared session metadata and transcript types from `packages/shared`
- API client types and request helpers in `apps/web/src/api.ts`
- connection settings model: backend URL and optional access token
- message and attachment metadata helpers in `apps/web/src/message-utils.ts`
- markdown/message rendering helpers where they are purely data/UI transformations

### Platform-specific code

These pieces intentionally stay platform-specific:

- Node/Hono backend runtime in `apps/server`
- filesystem conversation storage and provider credentials on the backend
- Electron folder picker, local backend child-process management, and desktop menus
- Capacitor native plugins and Android permissions/configuration
- future filesystem/storage adapters for a fully local mobile mode

## Current remote adapter

The current mobile/remote implementation treats the Hono server API as the canonical execution/storage adapter:

- list/create/rename/delete sessions
- load transcripts
- upload/read attachments
- send/edit messages
- stream updates over SSE
- provider/OAuth setup

Optional remote hardening is available with:

- `MEMORYHOLD_ACCESS_TOKEN` for bearer-token access control
- `MEMORYHOLD_ALLOWED_ORIGINS` for production CORS allow-listing

## Future local mobile adapter sketch

A future fully local mobile implementation should introduce explicit adapter interfaces rather than coupling the UI to HTTP:

### Storage adapter

- `listSessions()`
- `createSession()`
- `readSession(slug)`
- `writeTranscriptEntry(slug, entry)`
- `saveAttachment(slug, file)`
- `readAttachment(slug, path)`
- `readSettings()` / `writeSettings()`
- `readCredentials()` / `writeCredentials()`

### Execution adapter

- `sendMessage(slug, request)`
- `editMessage(slug, entryId, request)`
- `subscribeToSession(slug, handler)`
- report provider/model capabilities
- report tool capabilities
- manage provider credential flows

For now, `MemoryholdApi` is the remote implementation of those responsibilities. A future Capacitor-local implementation could use app-private storage, secure credential storage, and mobile-compatible execution/tool strategies.

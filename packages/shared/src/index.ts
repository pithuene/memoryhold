export interface SessionMetadata {
  id: string;
  slug: string;
  title: string;
  createdAt: string;
  lastModified: string;
  messageCount: number;
  currentLeafId: string | null;
  preview: string;
}

export interface SessionHeader {
  type: "session";
  version: 3;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

export interface SessionTreeEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface MessageEntry extends SessionTreeEntryBase {
  type: "message";
  message: unknown;
}

export interface ModelChangeEntry extends SessionTreeEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}

export interface ThinkingLevelChangeEntry extends SessionTreeEntryBase {
  type: "thinking_level_change";
  thinkingLevel: string;
}

export type SessionTreeEntry = MessageEntry | ModelChangeEntry | ThinkingLevelChangeEntry | (SessionTreeEntryBase & Record<string, unknown>);

export interface CreateSessionRequest {
  title?: string;
  systemPrompt?: string;
}

export interface SendMessageRequest {
  content: string;
  attachments?: UploadedAttachmentRef[];
  model?: {
    provider: string;
    modelId: string;
  };
  thinkingLevel?: string;
}

export interface UploadedAttachmentRef {
  id: string;
  filename: string;
  mimeType?: string;
  relativePath: string;
}

export type ServerEvent =
  | { type: "session_updated"; metadata: SessionMetadata }
  | { type: "entry_appended"; entry: SessionTreeEntry }
  | { type: "message_update"; parentId: string | null; content: string }
  | { type: "stream_status"; isStreaming: boolean }
  | { type: "error"; message: string };

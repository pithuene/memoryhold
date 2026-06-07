import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  appendFile,
  rm,
  rename,
} from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CreateSessionRequest,
  MessageEntry,
  ModelChangeEntry,
  SessionHeader,
  SessionMetadata,
  SessionTreeEntry,
  ThinkingLevelChangeEntry,
  UploadedAttachmentRef,
} from "@memoryhold/shared";

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "untitled"
  );
}

function sessionSlug(
  date: string,
  title: string,
  id: string,
  suffix = "",
): string {
  return `${date}-${slugify(title)}-${id.slice(0, 8)}${suffix}`;
}

export class SessionRepo {
  constructor(private readonly rootDir: string) {}

  async ensureRoot(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  private sessionDir(slug: string): string {
    return join(this.rootDir, slug);
  }

  private async sessionExists(slug: string): Promise<boolean> {
    try {
      await readFile(join(this.sessionDir(slug), "metadata.json"));
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<SessionMetadata[]> {
    await this.ensureRoot();
    const dirs = await readdir(this.rootDir, { withFileTypes: true });
    const items: SessionMetadata[] = [];
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      try {
        const meta = JSON.parse(
          await readFile(join(this.rootDir, dir.name, "metadata.json"), "utf8"),
        ) as SessionMetadata;
        items.push(meta);
      } catch {
        // Ignore incomplete/non-session dirs.
      }
    }
    return items.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  }

  async create(req: CreateSessionRequest = {}): Promise<SessionMetadata> {
    await this.ensureRoot();
    const id = randomUUID();
    const now = new Date().toISOString();
    const title = req.title?.trim() || "New conversation";
    const slug = sessionSlug(now.slice(0, 10), title, id);
    const dir = this.sessionDir(slug);
    await mkdir(join(dir, "attachments"), { recursive: true });

    const header: SessionHeader = {
      type: "session",
      version: 3,
      id,
      timestamp: now,
      cwd: process.cwd(),
    };
    await writeFile(join(dir, "session.jsonl"), `${JSON.stringify(header)}\n`);

    const metadata: SessionMetadata = {
      id,
      slug,
      title,
      createdAt: now,
      lastModified: now,
      messageCount: 0,
      currentLeafId: null,
      preview: "",
    };
    await this.saveMetadata(metadata);
    return metadata;
  }

  async get(
    slug: string,
  ): Promise<{ metadata: SessionMetadata; entries: SessionTreeEntry[] }> {
    const dir = this.sessionDir(slug);
    const metadata = JSON.parse(
      await readFile(join(dir, "metadata.json"), "utf8"),
    ) as SessionMetadata;
    const lines = (await readFile(join(dir, "session.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean);
    const entries = lines
      .slice(1)
      .map((line) => JSON.parse(line) as SessionTreeEntry);
    return { metadata, entries };
  }

  async delete(slug: string): Promise<void> {
    await rm(this.sessionDir(slug), { recursive: true, force: true });
  }

  async rename(slug: string, title: string): Promise<SessionMetadata> {
    const { metadata } = await this.get(slug);
    const nextTitle = title.trim();
    if (!nextTitle) throw new Error("Title is required");

    const oldDir = this.sessionDir(slug);
    const date = (metadata.createdAt || new Date().toISOString()).slice(0, 10);
    let nextSlug = sessionSlug(date, nextTitle, metadata.id);
    let counter = 2;
    while (nextSlug !== slug && (await this.sessionExists(nextSlug))) {
      nextSlug = sessionSlug(date, nextTitle, metadata.id, `-${counter++}`);
    }

    metadata.title = nextTitle.slice(0, 200);
    metadata.slug = nextSlug;
    metadata.lastModified = new Date().toISOString();
    if (nextSlug !== slug) await rename(oldDir, this.sessionDir(nextSlug));
    await this.saveMetadata(metadata);
    return metadata;
  }

  async appendUserMessage(
    slug: string,
    content: string,
    attachments: UploadedAttachmentRef[] = [],
  ): Promise<MessageEntry> {
    return this.appendMessage(slug, "user", content, undefined, attachments);
  }

  async appendModelChange(
    slug: string,
    provider: string,
    modelId: string,
  ): Promise<ModelChangeEntry> {
    const { metadata } = await this.get(slug);
    const entry: ModelChangeEntry = {
      type: "model_change",
      id: randomUUID().slice(0, 8),
      parentId: metadata.currentLeafId,
      timestamp: new Date().toISOString(),
      provider,
      modelId,
    };
    await this.appendEntryAndAdvance(slug, entry);
    return entry;
  }

  async appendThinkingLevelChange(
    slug: string,
    thinkingLevel: string,
  ): Promise<ThinkingLevelChangeEntry> {
    const { metadata } = await this.get(slug);
    const entry: ThinkingLevelChangeEntry = {
      type: "thinking_level_change",
      id: randomUUID().slice(0, 8),
      parentId: metadata.currentLeafId,
      timestamp: new Date().toISOString(),
      thinkingLevel,
    };
    await this.appendEntryAndAdvance(slug, entry);
    return entry;
  }

  async appendAssistantMessage(
    slug: string,
    content: string,
    parentId?: string | null,
  ): Promise<MessageEntry> {
    return this.appendMessage(slug, "assistant", content, parentId);
  }

  async appendRawMessage(
    slug: string,
    message: unknown,
  ): Promise<MessageEntry> {
    const { metadata } = await this.get(slug);
    const now = new Date().toISOString();
    const entry: MessageEntry = {
      type: "message",
      id: randomUUID().slice(0, 8),
      parentId: metadata.currentLeafId,
      timestamp: now,
      message,
    };
    await appendFile(
      join(this.sessionDir(slug), "session.jsonl"),
      `${JSON.stringify(entry)}\n`,
    );
    metadata.currentLeafId = entry.id;
    metadata.lastModified = now;
    metadata.messageCount += 1;
    const anyMessage = message as any;
    if (anyMessage?.role === "user") {
      const text =
        typeof anyMessage.content === "string"
          ? anyMessage.content
          : Array.isArray(anyMessage.content)
            ? anyMessage.content.map((b: any) => b?.text ?? "").join("\n")
            : "";
      metadata.preview = metadata.preview || text.slice(0, 500);
      if (metadata.title === "New conversation")
        metadata.title = text.split(/\s+/).slice(0, 8).join(" ");
    }
    await this.saveMetadata(metadata);
    return entry;
  }

  private async appendMessage(
    slug: string,
    role: "user" | "assistant",
    content: string,
    parentId?: string | null,
    attachments: UploadedAttachmentRef[] = [],
  ): Promise<MessageEntry> {
    const { metadata } = await this.get(slug);
    const now = new Date().toISOString();
    const entry: MessageEntry = {
      type: "message",
      id: randomUUID().slice(0, 8),
      parentId: parentId === undefined ? metadata.currentLeafId : parentId,
      timestamp: now,
      message: {
        role,
        content,
        timestamp: Date.now(),
        ...(attachments.length ? { attachments } : {}),
      },
    };
    await appendFile(
      join(this.sessionDir(slug), "session.jsonl"),
      `${JSON.stringify(entry)}\n`,
    );
    metadata.currentLeafId = entry.id;
    metadata.lastModified = now;
    metadata.messageCount += 1;
    if (role === "user") {
      metadata.preview = metadata.preview || content.slice(0, 500);
      if (metadata.title === "New conversation")
        metadata.title = content.split(/\s+/).slice(0, 8).join(" ");
    }
    await this.saveMetadata(metadata);
    return entry;
  }

  private async appendEntryAndAdvance(
    slug: string,
    entry: SessionTreeEntry,
  ): Promise<void> {
    const { metadata } = await this.get(slug);
    await appendFile(
      join(this.sessionDir(slug), "session.jsonl"),
      `${JSON.stringify(entry)}\n`,
    );
    metadata.currentLeafId = entry.id;
    metadata.lastModified = entry.timestamp;
    await this.saveMetadata(metadata);
  }

  async readAttachment(slug: string, relativePath: string): Promise<Buffer> {
    if (
      !relativePath.startsWith("attachments/") ||
      relativePath.includes("..")
    ) {
      throw new Error("Invalid attachment path");
    }
    return readFile(join(this.sessionDir(slug), relativePath));
  }

  async saveAttachment(
    slug: string,
    file: File,
  ): Promise<{
    id: string;
    filename: string;
    mimeType: string;
    relativePath: string;
  }> {
    const id = randomUUID();
    const safeName =
      file.name.replace(/[^a-zA-Z0-9._-]+/g, "_") ||
      `attachment${extname(file.name)}`;
    const filename = `${id.slice(0, 8)}-${safeName}`;
    const relativePath = `attachments/${filename}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await mkdir(join(this.sessionDir(slug), "attachments"), {
      recursive: true,
    });
    await writeFile(join(this.sessionDir(slug), relativePath), bytes);
    return { id, filename: file.name, mimeType: file.type, relativePath };
  }

  async truncateBeforeMessage(
    slug: string,
    entryId: string,
  ): Promise<UploadedAttachmentRef[]> {
    const dir = this.sessionDir(slug);
    const metadata = JSON.parse(
      await readFile(join(dir, "metadata.json"), "utf8"),
    ) as SessionMetadata;
    const lines = (await readFile(join(dir, "session.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean);
    const header = lines[0];
    const entries = lines
      .slice(1)
      .map((line) => JSON.parse(line) as SessionTreeEntry);
    const index = entries.findIndex(
      (entry: any) =>
        entry.type === "message" &&
        entry.id === entryId &&
        entry.message?.role === "user",
    );
    if (index === -1) throw new Error("User message not found");

    const oldEntry = entries[index] as MessageEntry;
    const attachments = ((oldEntry.message as any)?.attachments ??
      []) as UploadedAttachmentRef[];
    const kept = entries.slice(0, index);
    await writeFile(
      join(dir, "session.jsonl"),
      `${[header, ...kept.map((entry) => JSON.stringify(entry))].join("\n")}\n`,
    );
    const last = kept.at(-1);
    metadata.currentLeafId = last?.id ?? null;
    metadata.lastModified = new Date().toISOString();
    metadata.messageCount = kept.filter(
      (entry) => entry.type === "message",
    ).length;
    await this.saveMetadata(metadata);
    return attachments;
  }

  async saveMetadata(metadata: SessionMetadata): Promise<void> {
    await writeFile(
      join(this.sessionDir(metadata.slug), "metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
  }
}

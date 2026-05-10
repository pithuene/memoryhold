import { mkdir, readFile, readdir, writeFile, appendFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CreateSessionRequest, MessageEntry, SessionHeader, SessionMetadata, SessionTreeEntry, UploadedAttachmentRef } from "@memoryhold/shared";

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "untitled";
}

export class SessionRepo {
  constructor(private readonly rootDir: string) {}

  async ensureRoot(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  private sessionDir(slug: string): string {
    return join(this.rootDir, slug);
  }

  async list(): Promise<SessionMetadata[]> {
    await this.ensureRoot();
    const dirs = await readdir(this.rootDir, { withFileTypes: true });
    const items: SessionMetadata[] = [];
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      try {
        const meta = JSON.parse(await readFile(join(this.rootDir, dir.name, "metadata.json"), "utf8")) as SessionMetadata;
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
    const slug = `${now.slice(0, 10)}-${slugify(title)}-${id.slice(0, 8)}`;
    const dir = this.sessionDir(slug);
    await mkdir(join(dir, "attachments"), { recursive: true });

    const header: SessionHeader = { type: "session", version: 3, id, timestamp: now, cwd: process.cwd() };
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

  async get(slug: string): Promise<{ metadata: SessionMetadata; entries: SessionTreeEntry[] }> {
    const dir = this.sessionDir(slug);
    const metadata = JSON.parse(await readFile(join(dir, "metadata.json"), "utf8")) as SessionMetadata;
    const lines = (await readFile(join(dir, "session.jsonl"), "utf8")).split("\n").filter(Boolean);
    const entries = lines.slice(1).map((line) => JSON.parse(line) as SessionTreeEntry);
    return { metadata, entries };
  }

  async appendUserMessage(slug: string, content: string, attachments: UploadedAttachmentRef[] = []): Promise<MessageEntry> {
    return this.appendMessage(slug, "user", content, undefined, attachments);
  }

  async appendAssistantMessage(slug: string, content: string, parentId?: string | null): Promise<MessageEntry> {
    return this.appendMessage(slug, "assistant", content, parentId);
  }

  private async appendMessage(slug: string, role: "user" | "assistant", content: string, parentId?: string | null, attachments: UploadedAttachmentRef[] = []): Promise<MessageEntry> {
    const { metadata } = await this.get(slug);
    const now = new Date().toISOString();
    const entry: MessageEntry = {
      type: "message",
      id: randomUUID().slice(0, 8),
      parentId: parentId === undefined ? metadata.currentLeafId : parentId,
      timestamp: now,
      message: { role, content, timestamp: Date.now(), ...(attachments.length ? { attachments } : {}) },
    };
    await appendFile(join(this.sessionDir(slug), "session.jsonl"), `${JSON.stringify(entry)}\n`);
    metadata.currentLeafId = entry.id;
    metadata.lastModified = now;
    metadata.messageCount += 1;
    if (role === "user") {
      metadata.preview = metadata.preview || content.slice(0, 500);
      if (metadata.title === "New conversation") metadata.title = content.split(/\s+/).slice(0, 8).join(" ");
    }
    await this.saveMetadata(metadata);
    return entry;
  }

  async saveAttachment(slug: string, file: File): Promise<{ id: string; filename: string; mimeType: string; relativePath: string }> {
    const id = randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_") || `attachment${extname(file.name)}`;
    const filename = `${id.slice(0, 8)}-${safeName}`;
    const relativePath = `attachments/${filename}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await mkdir(join(this.sessionDir(slug), "attachments"), { recursive: true });
    await writeFile(join(this.sessionDir(slug), relativePath), bytes);
    return { id, filename: file.name, mimeType: file.type, relativePath };
  }

  async saveMetadata(metadata: SessionMetadata): Promise<void> {
    await writeFile(join(this.sessionDir(metadata.slug), "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  }
}

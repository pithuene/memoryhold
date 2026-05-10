import type { MessageEntry, ServerEvent, UploadedAttachmentRef } from "@memoryhold/shared";
import { EventHub } from "./events.js";
import { SessionRepo } from "./session-repo.js";

interface QueuedPrompt {
  parentEntry: MessageEntry;
  content: string;
  attachments: UploadedAttachmentRef[];
}

interface RuntimeState {
  isStreaming: boolean;
  queue: QueuedPrompt[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class SessionRunner {
  private states = new Map<string, RuntimeState>();

  constructor(
    private readonly repo: SessionRepo,
    private readonly events: EventHub,
  ) {}

  async enqueueUserMessage(slug: string, content: string, attachments: UploadedAttachmentRef[] = []): Promise<MessageEntry> {
    const userEntry = await this.repo.appendUserMessage(slug, content, attachments);
    await this.publishSessionUpdate(slug, { type: "entry_appended", entry: userEntry });

    const state = this.getState(slug);
    state.queue.push({ parentEntry: userEntry, content, attachments });
    if (!state.isStreaming) void this.drain(slug);
    return userEntry;
  }

  private getState(slug: string): RuntimeState {
    let state = this.states.get(slug);
    if (!state) {
      state = { isStreaming: false, queue: [] };
      this.states.set(slug, state);
    }
    return state;
  }

  private async drain(slug: string): Promise<void> {
    const state = this.getState(slug);
    if (state.isStreaming) return;
    state.isStreaming = true;
    this.events.publish(slug, { type: "stream_status", isStreaming: true });

    try {
      while (state.queue.length > 0) {
        const prompt = state.queue.shift()!;
        await this.generateMockAssistantResponse(slug, prompt);
      }
    } catch (error) {
      this.events.publish(slug, { type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      state.isStreaming = false;
      this.events.publish(slug, { type: "stream_status", isStreaming: false });
    }
  }

  private async generateMockAssistantResponse(slug: string, prompt: QueuedPrompt): Promise<void> {
    // Temporary stand-in for backend pi Agent execution. Keeps the UI/storage/queue/SSE path functional.
    const attachmentNote = prompt.attachments.length ? `\n\nReceived ${prompt.attachments.length} attachment(s): ${prompt.attachments.map((a) => a.relativePath).join(", ")}` : "";
    const response = `Mock assistant response. Backend agent integration is next.\n\nYou said: ${prompt.content}${attachmentNote}`;
    let partial = "";
    for (const token of response.split(/(\s+)/)) {
      partial += token;
      this.events.publish(slug, { type: "message_update", parentId: prompt.parentEntry.id, content: partial });
      await sleep(25);
    }

    const assistantEntry = await this.repo.appendAssistantMessage(slug, response, prompt.parentEntry.id);
    await this.publishSessionUpdate(slug, { type: "entry_appended", entry: assistantEntry });
  }

  private async publishSessionUpdate(slug: string, event: ServerEvent): Promise<void> {
    this.events.publish(slug, event);
    const { metadata } = await this.repo.get(slug);
    this.events.publish(slug, { type: "session_updated", metadata });
  }
}

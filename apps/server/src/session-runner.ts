import { Agent, type AgentEvent, type AgentMessage, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getModel, streamSimple } from "@earendil-works/pi-ai";
import { PDFParse } from "pdf-parse";
import type { MessageEntry, ServerEvent, UploadedAttachmentRef } from "@memoryhold/shared";
import { AuthStore } from "./auth-store.js";
import { EventHub } from "./events.js";
import { messageText, entriesToMessages } from "./message-utils.js";
import { SessionRepo } from "./session-repo.js";
import { createWebSearchTool } from "./tools.js";

interface RuntimeState {
  agent: Agent;
  isStreaming: boolean;
}

function userMessage(content: string, attachmentContext: string, attachments: UploadedAttachmentRef[]): AgentMessage {
  const suffix = attachmentContext ? `\n\n<MEMORYHOLD_ATTACHMENT_CONTEXT>\n${attachmentContext}\n</MEMORYHOLD_ATTACHMENT_CONTEXT>` : "";
  return { role: "user", content: [{ type: "text", text: content + suffix }], attachments, timestamp: Date.now() } as AgentMessage;
}

function truncateText(text: string, maxChars = 40_000): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}\n\n[Attachment text truncated at ${maxChars} characters.]` : normalized;
}

export class SessionRunner {
  private states = new Map<string, RuntimeState>();

  constructor(
    private readonly repo: SessionRepo,
    private readonly events: EventHub,
    private readonly authStore: AuthStore,
  ) {}

  isStreaming(slug: string): boolean {
    return this.states.get(slug)?.agent.state.isStreaming ?? false;
  }

  reset(slug: string): void {
    this.states.delete(slug);
  }

  async enqueueUserMessage(
    slug: string,
    content: string,
    attachments: UploadedAttachmentRef[] = [],
    options: { model?: { provider: string; modelId: string }; thinkingLevel?: string } = {},
  ): Promise<{ queued: boolean }> {
    const state = await this.getOrCreateState(slug, options);
    if (options.model) {
      state.agent.state.model = getModel(options.model.provider as any, options.model.modelId as any);
      const modelEntry = await this.repo.appendModelChange(slug, options.model.provider, options.model.modelId);
      await this.publishSessionUpdate(slug, { type: "entry_appended", entry: modelEntry });
    }
    if (options.thinkingLevel) {
      state.agent.state.thinkingLevel = options.thinkingLevel as ThinkingLevel;
      const thinkingEntry = await this.repo.appendThinkingLevelChange(slug, options.thinkingLevel);
      await this.publishSessionUpdate(slug, { type: "entry_appended", entry: thinkingEntry });
    }

    const attachmentContext = await this.buildAttachmentContext(slug, attachments);
    const message = userMessage(content, attachmentContext, attachments);
    if (state.agent.state.isStreaming) {
      state.agent.steer(message);
      return { queued: true };
    }

    void this.runPrompt(slug, state, message);
    return { queued: false };
  }

  private async buildAttachmentContext(slug: string, attachments: UploadedAttachmentRef[]): Promise<string> {
    if (!attachments.length) return "";
    const sections: string[] = ["The user attached file(s). Their extracted contents are included below. Use them to answer questions about the files."];
    for (const attachment of attachments) {
      const header = `Attachment: ${attachment.filename} (${attachment.mimeType || "unknown type"}, ${attachment.relativePath})`;
      try {
        const bytes = await this.repo.readAttachment(slug, attachment.relativePath);
        const lowerName = attachment.filename.toLowerCase();
        const mimeType = attachment.mimeType ?? "";
        if (mimeType === "application/pdf" || lowerName.endsWith(".pdf")) {
          const parser = new PDFParse({ data: bytes });
          const result = await parser.getText();
          await parser.destroy();
          sections.push(`${header}\n\n${truncateText(result.text || "[No extractable PDF text found.]")}`);
        } else if (mimeType.startsWith("text/") || /\.(md|txt|csv|json|xml|html|log|ts|tsx|js|jsx|py|rs|go|java|c|cpp|h)$/i.test(lowerName)) {
          sections.push(`${header}\n\n${truncateText(bytes.toString("utf8"))}`);
        } else {
          sections.push(`${header}\n\n[Unsupported attachment type for text extraction.]`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sections.push(`${header}\n\n[Could not read/extract attachment: ${message}]`);
      }
    }
    return sections.join("\n\n---\n\n");
  }

  private async getOrCreateState(slug: string, options: { model?: { provider: string; modelId: string }; thinkingLevel?: string }): Promise<RuntimeState> {
    const existing = this.states.get(slug);
    if (existing) return existing;

    const { metadata, entries } = await this.repo.get(slug);
    const modelRef = options.model ?? this.latestModel(entries) ?? { provider: "openai", modelId: "gpt-4o-mini" };
    const thinkingLevel = (options.thinkingLevel ?? this.latestThinkingLevel(entries) ?? "off") as ThinkingLevel;
    const agent = new Agent({
      sessionId: metadata.id,
      streamFn: streamSimple,
      getApiKey: async (provider) => {
        const key = await this.authStore.getApiKey(provider);
        if (!key) {
          throw new Error(`No credentials configured for provider '${provider}'. Use the OAuth panel or set the provider API key in the server environment.`);
        }
        return key;
      },
      initialState: {
        systemPrompt: "You are Memoryhold, a helpful assistant. Conversations are stored locally for the user.",
        model: getModel(modelRef.provider as any, modelRef.modelId as any),
        thinkingLevel,
        messages: entriesToMessages(entries),
        tools: [createWebSearchTool()],
      },
    });

    agent.subscribe(async (event) => this.handleAgentEvent(slug, event));
    const state = { agent, isStreaming: false };
    this.states.set(slug, state);
    return state;
  }

  private async runPrompt(slug: string, state: RuntimeState, message: AgentMessage): Promise<void> {
    state.isStreaming = true;
    this.events.publish(slug, { type: "stream_status", isStreaming: true });
    try {
      await state.agent.prompt(message);
      if (state.agent.state.errorMessage) {
        await this.persistSyntheticError(slug, state.agent.state.errorMessage);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.events.publish(slug, { type: "error", message });
      await this.persistSyntheticError(slug, message);
    } finally {
      state.isStreaming = false;
      this.events.publish(slug, { type: "stream_status", isStreaming: false });
    }
  }

  private async persistSyntheticError(slug: string, errorMessage: string): Promise<void> {
    const errorEntry = await this.repo.appendRawMessage(slug, {
      role: "assistant",
      content: [{ type: "text", text: "" }],
      stopReason: "error",
      errorMessage,
      timestamp: Date.now(),
    });
    this.events.publish(slug, { type: "error", message: errorMessage });
    await this.publishSessionUpdate(slug, { type: "entry_appended", entry: errorEntry });
  }

  private async handleAgentEvent(slug: string, event: AgentEvent): Promise<void> {
    if (event.type === "agent_end") {
      const last = event.messages[event.messages.length - 1] as any;
      if (last?.errorMessage) this.events.publish(slug, { type: "error", message: last.errorMessage });
      return;
    }
    if (event.type === "message_update") {
      this.events.publish(slug, { type: "message_update", parentId: null, content: messageText(event.message) });
      return;
    }
    if (event.type !== "message_end") return;

    const message = event.message as any;
    if (message.role !== "user" && message.role !== "assistant" && message.role !== "toolResult") return;
    if (message.errorMessage) this.events.publish(slug, { type: "error", message: message.errorMessage });
    const entry = await this.repo.appendRawMessage(slug, message);
    await this.publishSessionUpdate(slug, { type: "entry_appended", entry });
  }

  private latestModel(entries: any[]): { provider: string; modelId: string } | undefined {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.type === "model_change") return { provider: entry.provider, modelId: entry.modelId };
    }
    return undefined;
  }

  private latestThinkingLevel(entries: any[]): string | undefined {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.type === "thinking_level_change") return entry.thinkingLevel;
    }
    return undefined;
  }

  private async publishSessionUpdate(slug: string, event: ServerEvent): Promise<void> {
    this.events.publish(slug, event);
    const { metadata } = await this.repo.get(slug);
    this.events.publish(slug, { type: "session_updated", metadata });
  }
}

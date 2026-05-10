import { Agent, type AgentEvent, type AgentMessage, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getEnvApiKey, getModel, streamSimple } from "@earendil-works/pi-ai";
import type { MessageEntry, ServerEvent, UploadedAttachmentRef } from "@memoryhold/shared";
import { EventHub } from "./events.js";
import { messageText, entriesToMessages } from "./message-utils.js";
import { SessionRepo } from "./session-repo.js";
import { createWebSearchTool } from "./tools.js";

interface RuntimeState {
  agent: Agent;
  isStreaming: boolean;
}

function userMessage(content: string, attachments: UploadedAttachmentRef[]): AgentMessage {
  const suffix = attachments.length
    ? `\n\nAttachments saved locally:\n${attachments.map((a) => `- ${a.filename} (${a.relativePath})`).join("\n")}`
    : "";
  return { role: "user", content: [{ type: "text", text: content + suffix }], timestamp: Date.now() } as AgentMessage;
}

export class SessionRunner {
  private states = new Map<string, RuntimeState>();

  constructor(
    private readonly repo: SessionRepo,
    private readonly events: EventHub,
  ) {}

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

    const message = userMessage(content, attachments);
    if (state.agent.state.isStreaming) {
      state.agent.steer(message);
      return { queued: true };
    }

    void this.runPrompt(slug, state, message);
    return { queued: false };
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
      getApiKey: (provider) => getEnvApiKey(provider as any),
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
    } catch (error) {
      this.events.publish(slug, { type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      state.isStreaming = false;
      this.events.publish(slug, { type: "stream_status", isStreaming: false });
    }
  }

  private async handleAgentEvent(slug: string, event: AgentEvent): Promise<void> {
    if (event.type === "message_update") {
      this.events.publish(slug, { type: "message_update", parentId: null, content: messageText(event.message) });
      return;
    }
    if (event.type !== "message_end") return;

    const message = event.message as any;
    if (message.role !== "user" && message.role !== "assistant" && message.role !== "toolResult") return;
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

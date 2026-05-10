import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { SessionMetadata, SessionTreeEntry } from "@memoryhold/shared";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

@customElement("memoryhold-app")
class MemoryholdApp extends LitElement {
  @state() private sessions: SessionMetadata[] = [];
  @state() private active?: SessionMetadata;
  @state() private entries: SessionTreeEntry[] = [];
  @state() private draft = "";
  @state() private streamingContent = "";
  @state() private isStreaming = false;
  @state() private errorMessage = "";
  @state() private files: File[] = [];
  @state() private providers: Array<{ id: string; models: Array<{ id: string; name: string }> }> = [];
  @state() private selectedProvider = "";
  @state() private selectedModel = "";
  @state() private thinkingLevel = "off";
  @state() private oauthProviders: Array<{ id: string; name: string; authenticated: boolean }> = [];
  @state() private loginId = "";
  @state() private authUrl = "";
  @state() private callbackInput = "";
  private eventSource?: EventSource;

  static styles = css`
    :host { display: block; height: 100vh; max-height: 100vh; overflow: hidden; font-family: system-ui, sans-serif; color: #e5e7eb; background: #111827; }
    .layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); height: 100vh; overflow: hidden; }
    aside { border-right: 1px solid #374151; padding: 12px; overflow: auto; min-height: 0; }
    main { display: grid; grid-template-rows: minmax(0, 1fr) auto; min-width: 0; min-height: 0; overflow: hidden; }
    button { background: #2563eb; color: white; border: 0; border-radius: 8px; padding: 8px 10px; cursor: pointer; }
    .session { padding: 8px; border-radius: 8px; cursor: pointer; margin-top: 6px; }
    .session:hover, .session.active { background: #1f2937; }
    .messages { padding: 24px; overflow-y: auto; overflow-x: hidden; min-height: 0; }
    .msg { max-width: 850px; margin: 0 auto 16px; white-space: pre-wrap; line-height: 1.5; }
    .role { color: #9ca3af; font-size: 12px; margin-bottom: 4px; }
    form { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 16px; border-top: 1px solid #374151; }
    textarea { min-height: 64px; resize: vertical; border-radius: 8px; border: 1px solid #374151; background: #030712; color: #e5e7eb; padding: 10px; }
    .composer-extra { grid-column: 1 / -1; display: flex; align-items: center; gap: 12px; color: #9ca3af; font-size: 13px; }
    .error { margin: 8px 16px 0; padding: 10px; border-radius: 8px; background: #7f1d1d; color: #fecaca; white-space: pre-wrap; }
    select { width: 100%; margin: 4px 0 8px; background: #030712; color: #e5e7eb; border: 1px solid #374151; border-radius: 6px; padding: 6px; }
  `;

  override connectedCallback() {
    super.connectedCallback();
    void this.loadSessions();
    void this.loadProviders();
    void this.loadOAuthProviders();
  }

  private async loadSessions() {
    this.sessions = await fetch(`${API}/api/sessions`).then((r) => r.json());
  }

  private async loadOAuthProviders() {
    this.oauthProviders = await fetch(`${API}/api/oauth/providers`).then((r) => r.json());
  }

  private async startOAuth(providerId: string) {
    this.errorMessage = "";
    const result = await fetch(`${API}/api/oauth/${providerId}/start`, { method: "POST" }).then((r) => r.json());
    if (result.error) {
      this.errorMessage = result.error;
      return;
    }
    this.loginId = result.loginId;
    this.authUrl = result.authUrl ?? "";
    if (this.authUrl) window.open(this.authUrl, "_blank");
  }

  private async completeOAuth() {
    if (!this.loginId || !this.callbackInput.trim()) return;
    await fetch(`${API}/api/oauth/${this.loginId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: this.callbackInput }),
    });
    for (let i = 0; i < 30; i++) {
      const status = await fetch(`${API}/api/oauth/${this.loginId}/status`).then((r) => r.json());
      if (status.status === "done") {
        this.loginId = "";
        this.authUrl = "";
        this.callbackInput = "";
        await this.loadOAuthProviders();
        return;
      }
      if (status.status === "error") {
        this.errorMessage = status.error;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  private async loadProviders() {
    this.providers = await fetch(`${API}/api/providers`).then((r) => r.json());
    const preferredProvider = this.providers.find((p) => p.id === "openai-codex") ?? this.providers.find((p) => p.id === "openai") ?? this.providers[0];
    this.selectedProvider = preferredProvider?.id ?? "";
    this.selectedModel = preferredProvider?.models[0]?.id ?? "";
  }

  private async newSession() {
    const metadata = await fetch(`${API}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).then((r) => r.json());
    await this.loadSessions();
    await this.openSession(metadata);
  }

  private async openSession(session: SessionMetadata) {
    this.eventSource?.close();
    this.streamingContent = "";
    this.isStreaming = false;
    this.active = session;
    const data = await fetch(`${API}/api/sessions/${session.slug}`).then((r) => r.json());
    this.entries = data.entries;
    const es = new EventSource(`${API}/api/sessions/${session.slug}/events`);
    this.eventSource = es;
    es.onmessage = (message) => {
      const event = JSON.parse(message.data);
      if (event.type === "entry_appended") {
        this.streamingContent = "";
        this.entries = [...this.entries, event.entry];
      }
      if (event.type === "message_update") this.streamingContent = event.content;
      if (event.type === "stream_status") {
        this.isStreaming = event.isStreaming;
        if (!event.isStreaming && this.active) void this.openSession(this.active);
      }
      if (event.type === "error") this.errorMessage = event.message;
      if (event.type === "session_updated") {
        this.active = event.metadata;
        void this.loadSessions();
      }
    };
  }

  private renderMessage(message: any) {
    const body = this.renderContent(message.content);
    const error = message.errorMessage ? `Error: ${message.errorMessage}` : "";
    return [body, error].filter(Boolean).join("\n\n");
  }

  private renderContent(content: unknown) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((block: any) => {
        if (typeof block === "string") return block;
        if (block?.type === "text") return block.text ?? "";
        if (block?.type === "thinking") return `Thinking:\n${block.thinking ?? ""}`;
        if (block?.type === "toolCall") return `[tool call: ${block.name}]`;
        if (block?.type === "image") return `[image]`;
        return JSON.stringify(block);
      }).join("\n");
    }
    return content == null ? "" : JSON.stringify(content, null, 2);
  }

  private async send(ev: Event) {
    ev.preventDefault();
    if (!this.active || !this.draft.trim()) return;
    const content = this.draft;
    const files = this.files;
    this.draft = "";
    this.files = [];

    let attachments = [];
    if (files.length > 0) {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      const uploaded = await fetch(`${API}/api/sessions/${this.active.slug}/attachments`, { method: "POST", body: form }).then((r) => r.json());
      attachments = uploaded.attachments;
    }

    this.errorMessage = "";
    const response = await fetch(`${API}/api/sessions/${this.active.slug}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        attachments,
        model: this.selectedProvider && this.selectedModel ? { provider: this.selectedProvider, modelId: this.selectedModel } : undefined,
        thinkingLevel: this.thinkingLevel,
      }),
    });
    if (!response.ok) this.errorMessage = await response.text();
  }

  override render() {
    return html`
      <div class="layout">
        <aside>
          <h2>Memoryhold</h2>
          <button @click=${this.newSession}>New conversation</button>
          <h3>OAuth</h3>
          ${this.oauthProviders.map((p) => html`<button style="display:block;margin:4px 0;background:${p.authenticated ? "#059669" : "#374151"}" @click=${() => this.startOAuth(p.id)}>${p.authenticated ? "✓" : "Login"} ${p.name}</button>`)}
          ${this.loginId ? html`
            <small>Browser opened. If callback does not complete, paste redirect URL/code:</small>
            <textarea style="width:100%;min-height:60px" .value=${this.callbackInput} @input=${(e: InputEvent) => this.callbackInput = (e.target as HTMLTextAreaElement).value}></textarea>
            <button @click=${this.completeOAuth}>Complete login</button>
          ` : ""}
          <h3>Model</h3>
          <select .value=${this.selectedProvider} @change=${(e: Event) => {
            this.selectedProvider = (e.target as HTMLSelectElement).value;
            this.selectedModel = this.providers.find((p) => p.id === this.selectedProvider)?.models[0]?.id ?? "";
          }}>
            ${this.providers.map((p) => html`<option value=${p.id}>${p.id}</option>`)}
          </select>
          <select .value=${this.selectedModel} @change=${(e: Event) => this.selectedModel = (e.target as HTMLSelectElement).value}>
            ${this.providers.find((p) => p.id === this.selectedProvider)?.models.map((m) => html`<option value=${m.id}>${m.name || m.id}</option>`) ?? []}
          </select>
          <select .value=${this.thinkingLevel} @change=${(e: Event) => this.thinkingLevel = (e.target as HTMLSelectElement).value}>
            ${["off", "minimal", "low", "medium", "high"].map((level) => html`<option value=${level}>thinking: ${level}</option>`)}
          </select>
          ${this.sessions.map((s) => html`<div class="session ${this.active?.slug === s.slug ? "active" : ""}" @click=${() => this.openSession(s)}>${s.title}<br /><small>${new Date(s.lastModified).toLocaleString()}</small></div>`)}
        </aside>
        <main>
          ${this.errorMessage ? html`<div class="error">${this.errorMessage}</div>` : ""}
          <div class="messages">
            ${this.active ? html`
              ${this.entries.map((e: any) => {
                if (e.type === "message") return html`<div class="msg"><div class="role">${e.message.role}${e.message.stopReason === "error" ? " · error" : ""}</div>${this.renderMessage(e.message)}${e.message.attachments?.length ? html`<div class="role">attachments: ${e.message.attachments.map((a: any) => a.relativePath).join(", ")}</div>` : ""}</div>`;
                if (e.type === "model_change") return html`<div class="msg"><div class="role">model changed</div>${e.provider}/${e.modelId}</div>`;
                if (e.type === "thinking_level_change") return html`<div class="msg"><div class="role">thinking changed</div>${e.thinkingLevel}</div>`;
                return "";
              })}
              ${this.streamingContent ? html`<div class="msg"><div class="role">assistant · streaming</div>${this.streamingContent}</div>` : ""}
            ` : html`<p>Select or create a conversation.</p>`}
          </div>
          <form @submit=${this.send}>
            <textarea .value=${this.draft} @input=${(e: InputEvent) => this.draft = (e.target as HTMLTextAreaElement).value} placeholder="Message Memoryhold..."></textarea>
            <button>${this.isStreaming ? "Queue" : "Send"}</button>
            <div class="composer-extra">
              <input type="file" multiple @change=${(e: Event) => this.files = Array.from((e.target as HTMLInputElement).files ?? [])} />
              ${this.files.length ? html`<span>${this.files.length} file(s) selected</span>` : ""}
            </div>
          </form>
        </main>
      </div>
    `;
  }
}

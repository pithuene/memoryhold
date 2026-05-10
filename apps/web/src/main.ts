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
    :host { display:block; height:100vh; max-height:100vh; overflow:hidden; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:#e5e7eb; background:#0b1020; }
    * { box-sizing: border-box; }
    .layout { display:grid; grid-template-columns: 320px minmax(0, 1fr); height:100vh; overflow:hidden; background: radial-gradient(circle at top left, #172554 0, #0b1020 34%, #080b14 100%); }
    aside { display:flex; flex-direction:column; gap:16px; border-right:1px solid rgba(148,163,184,.18); padding:18px; overflow:auto; min-height:0; background:rgba(8,13,25,.86); backdrop-filter: blur(18px); }
    main { display:grid; grid-template-rows:auto minmax(0, 1fr) auto; min-width:0; min-height:0; overflow:hidden; }
    .brand { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    h2 { margin:0; font-size:20px; letter-spacing:-.02em; }
    h3 { margin:0 0 8px; color:#94a3b8; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; }
    .panel { padding:12px; border:1px solid rgba(148,163,184,.14); border-radius:16px; background:rgba(15,23,42,.55); }
    button { background:#2563eb; color:white; border:0; border-radius:12px; padding:10px 12px; cursor:pointer; font-weight:650; transition:.15s ease; }
    button:hover { filter:brightness(1.12); transform:translateY(-1px); }
    button.secondary { background:#1e293b; color:#cbd5e1; }
    button.success { background:#047857; }
    .new-btn { width:100%; }
    .session-list { display:flex; flex-direction:column; gap:6px; }
    .session { padding:11px 12px; border:1px solid transparent; border-radius:13px; cursor:pointer; color:#cbd5e1; }
    .session:hover { background:rgba(30,41,59,.75); }
    .session.active { background:rgba(37,99,235,.18); border-color:rgba(96,165,250,.35); color:white; }
    .session-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:14px; }
    small, .muted { color:#64748b; font-size:12px; }
    .topbar { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:64px; padding:0 28px; border-bottom:1px solid rgba(148,163,184,.14); background:rgba(8,13,25,.5); }
    .chat-title { min-width:0; }
    .chat-title strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .status-pill { border:1px solid rgba(148,163,184,.2); border-radius:999px; padding:6px 10px; color:#94a3b8; font-size:12px; background:rgba(15,23,42,.7); }
    .messages { padding:32px 28px; overflow-y:auto; overflow-x:hidden; min-height:0; scroll-behavior:smooth; }
    .empty { max-width:680px; margin:18vh auto 0; text-align:center; color:#94a3b8; }
    .empty h1 { color:white; margin:0 0 8px; font-size:34px; letter-spacing:-.04em; }
    .msg { max-width:880px; margin:0 auto 18px; white-space:pre-wrap; line-height:1.65; font-size:15px; }
    .bubble { padding:16px 18px; border-radius:18px; border:1px solid rgba(148,163,184,.14); background:rgba(15,23,42,.72); box-shadow:0 10px 30px rgba(0,0,0,.12); }
    .msg.user .bubble { margin-left:auto; max-width:78%; background:#2563eb; border-color:rgba(147,197,253,.35); color:white; }
    .msg.assistant .bubble { background:rgba(15,23,42,.72); }
    .msg.error .bubble { background:rgba(127,29,29,.35); border-color:rgba(248,113,113,.35); color:#fecaca; }
    .role { color:#94a3b8; font-size:12px; font-weight:700; margin:0 0 6px; text-transform:capitalize; }
    .timeline { max-width:880px; margin:0 auto 14px; color:#64748b; font-size:12px; display:flex; align-items:center; gap:10px; }
    .timeline:before, .timeline:after { content:""; height:1px; background:rgba(148,163,184,.15); flex:1; }
    form { padding:18px 28px 22px; border-top:1px solid rgba(148,163,184,.14); background:linear-gradient(to top, rgba(8,13,25,.96), rgba(8,13,25,.82)); }
    .composer { max-width:920px; margin:0 auto; display:grid; grid-template-columns:1fr auto; gap:10px; padding:10px; border:1px solid rgba(148,163,184,.22); border-radius:20px; background:rgba(2,6,23,.82); box-shadow:0 18px 60px rgba(0,0,0,.25); }
    textarea { min-height:58px; max-height:180px; resize:vertical; border:0; outline:0; background:transparent; color:#e5e7eb; padding:10px 12px; font:inherit; line-height:1.45; }
    .send-btn { align-self:end; min-width:84px; border-radius:14px; }
    .composer-extra { grid-column:1 / -1; display:flex; align-items:center; gap:12px; padding:0 8px 4px; color:#94a3b8; font-size:13px; }
    .error { margin:12px 28px 0; padding:12px 14px; border:1px solid rgba(248,113,113,.35); border-radius:12px; background:rgba(127,29,29,.35); color:#fecaca; white-space:pre-wrap; }
    select, .oauth-textarea { width:100%; margin:4px 0 8px; background:#020617; color:#e5e7eb; border:1px solid rgba(148,163,184,.22); border-radius:10px; padding:9px; }
    .oauth-buttons { display:grid; gap:8px; }
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
          <div class="brand"><h2>Memoryhold</h2></div>
          <button class="new-btn" @click=${this.newSession}>＋ New conversation</button>
          <section class="panel">
            <h3>Accounts</h3>
            <div class="oauth-buttons">
              ${this.oauthProviders.map((p) => html`<button class=${p.authenticated ? "success" : "secondary"} @click=${() => this.startOAuth(p.id)}>${p.authenticated ? "✓" : "Login"} ${p.name}</button>`)}
            </div>
            ${this.loginId ? html`
              <p><small>Browser opened. If callback does not complete, paste redirect URL/code:</small></p>
              <textarea class="oauth-textarea" .value=${this.callbackInput} @input=${(e: InputEvent) => this.callbackInput = (e.target as HTMLTextAreaElement).value}></textarea>
              <button @click=${this.completeOAuth}>Complete login</button>
            ` : ""}
          </section>
          <section class="panel">
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
          </section>
          <section>
            <h3>Conversations</h3>
            <div class="session-list">
              ${this.sessions.map((s) => html`<div class="session ${this.active?.slug === s.slug ? "active" : ""}" @click=${() => this.openSession(s)}><div class="session-title">${s.title}</div><small>${new Date(s.lastModified).toLocaleString()}</small></div>`)}
            </div>
          </section>
        </aside>
        <main>
          <header class="topbar">
            <div class="chat-title"><strong>${this.active?.title ?? "No conversation selected"}</strong><small>${this.selectedProvider}${this.selectedModel ? ` / ${this.selectedModel}` : ""}</small></div>
            <div class="status-pill">${this.isStreaming ? "Streaming" : "Ready"}</div>
          </header>
          ${this.errorMessage ? html`<div class="error">${this.errorMessage}</div>` : ""}
          <div class="messages">
            ${this.active ? html`
              ${this.entries.map((e: any) => {
                if (e.type === "message") {
                  const role = e.message.role === "toolResult" ? "tool" : e.message.role;
                  const classes = `msg ${role} ${e.message.stopReason === "error" ? "error" : ""}`;
                  return html`<div class=${classes}><div class="role">${role}${e.message.stopReason === "error" ? " · error" : ""}</div><div class="bubble">${this.renderMessage(e.message)}${e.message.attachments?.length ? html`<div class="role">attachments: ${e.message.attachments.map((a: any) => a.relativePath).join(", ")}</div>` : ""}</div></div>`;
                }
                if (e.type === "model_change") return html`<div class="timeline">model: ${e.provider}/${e.modelId}</div>`;
                if (e.type === "thinking_level_change") return html`<div class="timeline">thinking: ${e.thinkingLevel}</div>`;
                return "";
              })}
              ${this.streamingContent ? html`<div class="msg assistant"><div class="role">assistant · streaming</div><div class="bubble">${this.streamingContent}</div></div>` : ""}
            ` : html`<div class="empty"><h1>Your local AI memory.</h1><p>Create or select a conversation to start chatting.</p></div>`}
          </div>
          <form @submit=${this.send}>
            <div class="composer">
              <textarea .value=${this.draft} @input=${(e: InputEvent) => this.draft = (e.target as HTMLTextAreaElement).value} placeholder="Message Memoryhold..."></textarea>
              <button class="send-btn">${this.isStreaming ? "Queue" : "Send"}</button>
              <div class="composer-extra">
                <input type="file" multiple @change=${(e: Event) => this.files = Array.from((e.target as HTMLInputElement).files ?? [])} />
                ${this.files.length ? html`<span>${this.files.length} file(s) selected</span>` : ""}
              </div>
            </div>
          </form>
        </main>
      </div>
    `;
  }
}

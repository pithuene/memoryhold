import { LitElement, css, html, unsafeCSS } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { customElement, state } from "lit/decorators.js";
import type { SessionMetadata, SessionTreeEntry } from "@memoryhold/shared";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import DOMPurify from "dompurify";
import katexCss from "katex/dist/katex.min.css?inline";

marked.use(markedKatex({ throwOnError: false, displayMode: false, nonStandard: true }));

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
const SETTINGS_KEY = "memoryhold.settings";

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
  @state() private view: "chat" | "settings" = "chat";
  @state() private sidebarCollapsed = false;
  @state() private editingEntryId = "";
  @state() private editingDraft = "";
  private eventSource?: EventSource;
  private shouldScrollToBottom = false;

  static styles = [unsafeCSS(katexCss), css`
    :host { display:block; height:100vh; max-height:100vh; overflow:hidden; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:#0d0d0d; background:#fff; }
    * { box-sizing:border-box; }
    .layout { display:grid; grid-template-columns:260px minmax(0,1fr); height:100vh; overflow:hidden; background:#fff; }
    .layout.sidebar-collapsed { grid-template-columns:0 minmax(0,1fr); }
    aside { display:flex; flex-direction:column; gap:4px; min-height:0; overflow:auto; padding:12px 8px 0; background:#f9f9f9; border-right:1px solid #e5e5e5; }
    .layout.sidebar-collapsed aside { padding:0; border-right:0; overflow:hidden; }
    main { display:grid; grid-template-rows:auto minmax(0,1fr) auto; min-width:0; min-height:0; overflow:hidden; background:#fff; }
    .brand { display:flex; align-items:center; justify-content:space-between; height:40px; padding:0 8px 8px; }
    h2 { margin:0; font-size:18px; font-weight:700; letter-spacing:-.02em; }
    h3 { margin:20px 8px 6px; color:#111; font-size:13px; font-weight:700; }
    button { border:0; border-radius:10px; padding:9px 10px; background:#0d0d0d; color:white; cursor:pointer; font-weight:600; font-size:14px; }
    button:hover { background:#2f2f2f; }
    button.secondary { background:#f4f4f4; color:#0d0d0d; border:1px solid #e3e3e3; }
    button.success { background:#e7f8ef; color:#087443; border:1px solid #bbe8cf; }
    .new-btn, .nav-btn { width:100%; justify-content:flex-start; text-align:left; background:transparent; color:#111; border-radius:10px; box-shadow:none; padding:9px 10px; font-weight:500; display:flex; align-items:center; gap:10px; }
    .new-btn:hover, .nav-btn:hover, .session:hover { background:#ececec; }
    .nav-btn { justify-content:flex-start; gap:10px; }
    .nav-btn.active, .session.active { background:#ececec; color:#111; }
    .side-icon { width:18px; display:inline-grid; place-items:center; font-size:18px; line-height:1; color:#111; }
    .session-list { display:flex; flex-direction:column; gap:2px; }
    .session { padding:8px 10px; border-radius:10px; cursor:pointer; color:#111; }
    .session-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:14px; line-height:1.35; }
    small, .muted { color:#777; font-size:12px; }
    .topbar { display:flex; align-items:center; justify-content:space-between; min-height:52px; padding:0 18px; border-bottom:1px solid #eeeeee; background:rgba(255,255,255,.9); }
    .topbar-left { display:flex; align-items:center; gap:12px; min-width:0; }
    .sidebar-toggle { width:34px; height:34px; border-radius:9px; padding:0; background:transparent; color:#111; display:grid; place-items:center; font-size:17px; }
    .sidebar-toggle:hover { background:#ececec; }
    .chat-title strong { display:block; max-width:60vw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:15px; font-weight:650; }
    .status-pill { color:#555; font-size:13px; }
    .messages { min-height:0; overflow-y:auto; overflow-x:hidden; padding:28px 24px 120px; background:#fff; scroll-behavior:smooth; }
    .thread { max-width:768px; margin:0 auto; }
    .empty { max-width:760px; margin:22vh auto 0; text-align:center; color:#6b6b6b; }
    .empty h1 { margin:0 0 10px; color:#111; font-size:32px; letter-spacing:-.04em; }
    .msg { display:flex; gap:14px; margin:0 auto 26px; line-height:1.65; font-size:16px; }
    .msg.user { justify-content:flex-end; }
    .avatar, .role { display:none; }
    .message-body { min-width:0; max-width:100%; }
    .msg.user .message-body { max-width:min(70%, 640px); }
    .bubble { width:100%; max-width:100%; padding:0; border:0; background:transparent; box-shadow:none; }
    .msg.user .bubble { width:fit-content; padding:10px 16px; border-radius:22px; background:#f4f4f4; color:#0d0d0d; }
    .message-actions { display:flex; gap:4px; opacity:0; transition:opacity .12s ease; margin-top:6px; }
    .msg:hover .message-actions, .msg:focus-within .message-actions { opacity:1; }
    .msg.user .message-actions { justify-content:flex-end; padding-right:8px; }
    .action-btn { width:30px; height:30px; padding:0; border-radius:8px; display:grid; place-items:center; background:transparent; color:#666; font-size:15px; }
    .action-btn:hover { background:#ececec; color:#111; }
    .msg.user.editing { justify-content:flex-start; }
    .msg.user.editing .message-body { width:100%; max-width:100%; }
    .msg.user.editing .bubble { width:100%; min-height:132px; padding:20px; border-radius:24px; text-align:left; }
    .edit-box { min-height:92px; position:relative; width:100%; padding-bottom:42px; }
    .edit-textarea { display:block; width:100%; min-height:28px; max-height:190px; resize:none; border:0; outline:0; background:transparent; border-radius:0; padding:0; font:inherit; line-height:1.45; color:#111; overflow:auto; text-align:left; }
    .edit-actions { position:absolute; right:0; bottom:0; display:flex; align-items:center; gap:10px; }
    .edit-actions button { padding:8px 15px; border-radius:999px; font-size:14px; font-weight:650; }
    .edit-actions .cancel { background:#fff; color:#111; border:1px solid #ddd; }
    .edit-actions .cancel:hover { background:#f6f6f6; }
    .edit-actions .save { background:#0d0d0d; color:#fff; }
    .msg.error { margin-top:8px; }
    .msg.error .bubble { padding:12px 14px 12px 38px; border-radius:12px; border:1px solid #f1b8b8; background:#fff7f7; color:#8a1f1f; position:relative; box-shadow:none; }
    .msg.error .bubble::before { content:"!"; position:absolute; left:14px; top:14px; width:16px; height:16px; border-radius:999px; display:grid; place-items:center; background:#ef4444; color:white; font-size:11px; font-weight:800; }
    form { padding:0 24px 8px; background:linear-gradient(180deg, rgba(255,255,255,0), #fff 22%); }
    .composer { max-width:768px; margin:0 auto; display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:8px; padding:7px 8px; border:1px solid #d9d9d9; border-radius:28px; background:#fff; box-shadow:0 8px 28px rgba(0,0,0,.08); }
    textarea { grid-column:2; min-height:42px; max-height:180px; resize:none; border:0; outline:0; background:transparent; color:#0d0d0d; padding:10px 6px; font:inherit; line-height:1.45; }
    .send-btn { grid-column:3; align-self:center; min-width:42px; width:42px; height:42px; padding:0; border-radius:999px; font-size:0; position:relative; }
    .send-btn::before { content:"↑"; font-size:22px; line-height:1; }
    .composer-extra { grid-column:1; grid-row:1; display:flex; align-items:center; gap:8px; padding:0; color:#777; font-size:0; }
    input[type="file"] { display:none; }
    .file-label { display:grid; place-items:center; width:38px; height:38px; border-radius:999px; border:1px solid #e3e3e3; background:#fff; color:#111; font-size:0; cursor:pointer; }
    .file-label::before { content:"+"; font-size:24px; line-height:1; }
    .composer-extra span { display:none; }
    .selected-files { max-width:768px; margin:0 auto -1px; display:flex; flex-wrap:wrap; align-items:flex-start; gap:10px; padding:12px 14px 8px; border:1px solid #d9d9d9; border-bottom:0; border-radius:24px 24px 0 0; background:#fff; box-shadow:0 8px 28px rgba(0,0,0,.08); overflow:visible; }
    .selected-file { position:relative; flex:0 1 258px; display:grid; grid-template-columns:38px minmax(0,1fr); gap:9px; align-items:center; min-width:180px; max-width:258px; padding:7px 34px 7px 8px; border:1px solid #dedede; border-radius:12px; background:#fff; color:#111; }
    .selected-file-thumb, .attachment-icon { width:38px; height:38px; border-radius:8px; display:grid; place-items:center; object-fit:cover; background:#f0f0f0; font-size:11px; font-weight:700; color:#555; overflow:hidden; }
    .selected-file-name, .attachment-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; line-height:1.2; font-weight:600; }
    .selected-file-meta, .attachment-meta { color:#777; font-size:12px; line-height:1.2; margin-top:2px; }
    .remove-file { position:absolute; top:-8px; right:-8px; z-index:2; width:22px; height:22px; padding:0; border-radius:999px; display:grid; place-items:center; background:#111; color:#fff; font-size:14px; line-height:1; }
    .remove-file:hover { background:#333; }
    .composer.with-files { border-top-left-radius:0; border-top-right-radius:0; }
    .attachment-list { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 8px; }
    .attachment-chip { display:grid; grid-template-columns:38px minmax(0,1fr); gap:9px; align-items:center; max-width:300px; padding:7px 10px 7px 8px; border:1px solid #dedede; border-radius:12px; background:#fff; color:#111; box-shadow:0 1px 2px rgba(0,0,0,.03); }
    .attachment-image { width:38px; height:38px; border-radius:8px; object-fit:cover; background:#eee; }
    .msg.user .attachment-chip { background:#fff; }
    .thinking-row { display:flex; align-items:center; gap:8px; margin:0 0 14px; color:#8a8a8a; font-size:16px; }
    .thinking-caret { color:#aaa; font-size:18px; }
    .thinking-dots { display:inline-flex; gap:3px; margin-left:1px; }
    .thinking-dots span { width:4px; height:4px; border-radius:999px; background:#999; animation:thinkingPulse 1.2s infinite ease-in-out; }
    .thinking-dots span:nth-child(2) { animation-delay:.16s; }
    .thinking-dots span:nth-child(3) { animation-delay:.32s; }
    @keyframes thinkingPulse { 0%, 80%, 100% { opacity:.25; transform:translateY(0); } 40% { opacity:1; transform:translateY(-2px); } }
    .markdown { white-space:normal; overflow-wrap:anywhere; }
    .markdown > :first-child { margin-top:0; }
    .markdown > :last-child { margin-bottom:0; }
    .markdown p, .markdown ul, .markdown ol, .markdown blockquote, .markdown pre, .markdown table { margin:0 0 14px; }
    .markdown ul, .markdown ol { padding-left:24px; }
    .markdown li { margin:3px 0; }
    .markdown h1, .markdown h2, .markdown h3 { color:#111; margin:22px 0 10px; font-weight:700; letter-spacing:-.02em; text-transform:none; }
    .markdown a { color:#0b57d0; }
    .markdown code { padding:2px 5px; border-radius:5px; background:#f2f2f2; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:.9em; }
    .markdown pre { overflow:auto; padding:14px; border-radius:10px; background:#f6f6f6; border:1px solid #e5e5e5; }
    .markdown pre code { padding:0; background:transparent; }
    .markdown blockquote { padding-left:14px; border-left:4px solid #d9d9d9; color:#444; }
    .markdown table { border-collapse:collapse; display:block; overflow:auto; }
    .markdown th, .markdown td { border:1px solid #ddd; padding:6px 9px; }
    .markdown .katex-display { overflow-x:auto; overflow-y:hidden; padding:8px 0; }
    .error-banner { margin:12px 24px 0; padding:12px 14px; border:1px solid #f1b8b8; border-radius:12px; background:#fff0f0; color:#8a1f1f; white-space:pre-wrap; }
    .settings { padding:34px 24px; overflow:auto; background:#fff; }
    .settings-inner { max-width:820px; margin:0 auto; display:grid; gap:18px; }
    .settings-hero h1 { margin:0 0 6px; font-size:30px; letter-spacing:-.04em; }
    .settings-card { padding:18px; border:1px solid #e5e5e5; border-radius:16px; background:#fff; box-shadow:0 8px 24px rgba(0,0,0,.04); }
    .settings-card h2 { font-size:16px; margin:0 0 6px; }
    .settings-card p { margin:0 0 14px; color:#666; font-size:14px; line-height:1.5; }
    .settings-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; }
    .account-list { display:grid; gap:10px; }
    .account-row { display:grid; grid-template-columns:1fr auto; gap:12px; align-items:center; padding:12px; border:1px solid #eee; border-radius:14px; background:#fafafa; }
    .account-name { font-weight:700; }
    .account-status { color:#777; font-size:12px; margin-top:2px; }
    select, .oauth-textarea { width:100%; margin:4px 0 8px; background:#fff; color:#111; border:1px solid #ddd; border-radius:10px; padding:9px; }
    @media (max-width:900px) { .layout { grid-template-columns:1fr; } aside { display:none; } .msg.user .message-body { max-width:86%; } }
    @media (max-width:760px) { .settings-grid { grid-template-columns:1fr; } .thread,.composer { max-width:100%; } }
  `]
  override connectedCallback() {
    super.connectedCallback();
    void this.loadSessions();
    void this.loadProviders();
    void this.loadOAuthProviders();
    window.addEventListener("popstate", this.handlePopState);
  }

  override disconnectedCallback() {
    window.removeEventListener("popstate", this.handlePopState);
    this.eventSource?.close();
    super.disconnectedCallback();
  }

  private handlePopState = () => {
    void this.openSessionFromUrl(false);
  };

  private async loadSessions() {
    this.sessions = await fetch(`${API}/api/sessions`).then((r) => r.json());
    await this.openSessionFromUrl(false);
  }

  private sessionSlugFromUrl() {
    const match = window.location.pathname.match(/^\/c\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  private async openSessionFromUrl(updateHistory = false) {
    const slug = this.sessionSlugFromUrl();
    if (!slug || this.active?.slug === slug) return;
    const session = this.sessions.find((item) => item.slug === slug);
    if (session) await this.openSession(session, updateHistory);
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
    const saved = this.loadSavedSettings();
    const savedProvider = saved?.provider ? this.providers.find((p) => p.id === saved.provider) : undefined;
    const preferredProvider = savedProvider ?? this.providers.find((p) => p.id === "openai-codex") ?? this.providers.find((p) => p.id === "openai") ?? this.providers[0];
    this.selectedProvider = preferredProvider?.id ?? "";
    this.selectedModel = preferredProvider?.models.find((m) => m.id === saved?.modelId)?.id ?? preferredProvider?.models[0]?.id ?? "";
    this.thinkingLevel = saved?.thinkingLevel ?? this.thinkingLevel;
    this.saveSettings();
  }

  private loadSavedSettings(): { provider?: string; modelId?: string; thinkingLevel?: string } | undefined {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : undefined;
    } catch {
      return undefined;
    }
  }

  private saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      provider: this.selectedProvider,
      modelId: this.selectedModel,
      thinkingLevel: this.thinkingLevel,
    }));
  }

  private selectProvider(provider: string) {
    this.selectedProvider = provider;
    this.selectedModel = this.providers.find((p) => p.id === this.selectedProvider)?.models[0]?.id ?? "";
    this.saveSettings();
  }

  private selectModel(modelId: string) {
    this.selectedModel = modelId;
    this.saveSettings();
  }

  private selectThinkingLevel(thinkingLevel: string) {
    this.thinkingLevel = thinkingLevel;
    this.saveSettings();
  }

  private async newSession() {
    const metadata = await fetch(`${API}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).then((r) => r.json());
    await this.loadSessions();
    await this.openSession(metadata);
  }

  private async openSession(session: SessionMetadata, updateHistory = true) {
    this.eventSource?.close();
    this.streamingContent = "";
    this.isStreaming = false;
    this.active = session;
    this.view = "chat";
    if (updateHistory) window.history.pushState({}, "", `/c/${encodeURIComponent(session.slug)}`);
    const data = await fetch(`${API}/api/sessions/${session.slug}`).then((r) => r.json());
    this.entries = data.entries;
    this.shouldScrollToBottom = true;
    const es = new EventSource(`${API}/api/sessions/${session.slug}/events`);
    this.eventSource = es;
    es.onmessage = (message) => {
      const event = JSON.parse(message.data);
      if (event.type === "entry_appended") {
        this.streamingContent = "";
        this.entries = [...this.entries, event.entry];
        this.shouldScrollToBottom = true;
      }
      if (event.type === "message_update") {
        this.streamingContent = event.content;
        this.shouldScrollToBottom = true;
      }
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

  private messageDisplayText(message: any) {
    return this.renderContent(message.content)
      .replace(/\n\n<MEMORYHOLD_ATTACHMENT_CONTEXT>[\s\S]*?<\/MEMORYHOLD_ATTACHMENT_CONTEXT>/g, "")
      .replace(/\n*Attachments saved locally:\n(?:\s*-\s+.*(?:\n|$))+/g, "")
      .trim();
  }

  override updated() {
    if (!this.shouldScrollToBottom) return;
    this.shouldScrollToBottom = false;
    requestAnimationFrame(() => {
      const messages = this.renderRoot.querySelector(".messages");
      if (messages) messages.scrollTop = messages.scrollHeight;
    });
  }

  private renderMessage(message: any) {
    const body = this.messageDisplayText(message);
    const error = message.errorMessage ? `Error: ${message.errorMessage}` : "";
    return this.renderMarkdown([body, error].filter(Boolean).join("\n\n"));
  }

  private messageAttachments(message: any) {
    if (message.attachments?.length) return message.attachments;
    const text = this.renderContent(message.content);
    const context = text.match(/<MEMORYHOLD_ATTACHMENT_CONTEXT>[\s\S]*?<\/MEMORYHOLD_ATTACHMENT_CONTEXT>/)?.[0] ?? "";
    return Array.from(context.matchAll(/Attachment: (.+?) \((.+?), (attachments\/.+?)\)/g)).map((match) => ({
      filename: match[1],
      mimeType: match[2],
      relativePath: match[3],
    }));
  }

  private renderAttachments(attachments: any[] = []) {
    if (!attachments.length) return "";
    return html`<div class="attachment-list">
      ${attachments.map((attachment) => html`<div class="attachment-chip" title=${attachment.relativePath ?? attachment.filename ?? "Attachment"}>
        ${this.isImageAttachment(attachment) && this.active ? html`<img class="attachment-image" src=${`${API}/api/sessions/${this.active.slug}/${attachment.relativePath}`} />` : html`<div class="attachment-icon">${this.attachmentIcon(attachment.filename)}</div>`}
        <div>
          <div class="attachment-name">${attachment.filename ?? "Attachment"}</div>
          <div class="attachment-meta">${this.attachmentKind(attachment.filename, attachment.mimeType)}</div>
        </div>
      </div>`)}
    </div>`;
  }

  private renderSelectedFiles() {
    if (!this.files.length) return "";
    return html`<div class="selected-files">${this.files.map((file, index) => html`<div class="selected-file" title=${file.name}>
      ${file.type.startsWith("image/") ? html`<img class="selected-file-thumb" src=${URL.createObjectURL(file)} />` : html`<div class="selected-file-thumb">${this.attachmentIcon(file.name)}</div>`}
      <div><div class="selected-file-name">${file.name}</div><div class="selected-file-meta">${this.attachmentKind(file.name, file.type)}</div></div>
      <button type="button" class="remove-file" title="Remove file" @click=${() => this.files = this.files.filter((_, i) => i !== index)}>×</button>
    </div>`)}</div>`;
  }

  private isImageAttachment(attachment: any) {
    return attachment?.mimeType?.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(attachment?.filename ?? "");
  }

  private attachmentKind(filename = "", mimeType = "") {
    const lower = filename.toLowerCase();
    if (mimeType === "application/pdf" || lower.endsWith(".pdf")) return "PDF";
    if (mimeType.startsWith("image/") || lower.match(/\.(png|jpe?g|gif|webp|svg)$/)) return "Image";
    if (mimeType.startsWith("text/") || lower.match(/\.(txt|md|csv|log)$/)) return "Document";
    if (lower.match(/\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|css|html|json)$/)) return "Code";
    return "File";
  }

  private attachmentIcon(filename = "") {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".pdf")) return "PDF";
    if (lower.match(/\.(png|jpe?g|gif|webp|svg)$/)) return "IMG";
    if (lower.match(/\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|css|html|json|md)$/)) return "{}";
    return "DOC";
  }

  private renderThinkingIndicator(label = "Thinking") {
    return html`<div class="thinking-row"><span>${label}</span><span class="thinking-dots"><span></span><span></span><span></span></span><span class="thinking-caret">›</span></div>`;
  }

  private renderMarkdown(markdown: string) {
    const normalized = markdown
      .replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula) => `\n$$\n${formula.trim()}\n$$\n`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_match, formula) => `$${formula.trim()}$`);
    const rawHtml = marked.parse(normalized, { async: false }) as string;
    return html`<div class="markdown">${unsafeHTML(DOMPurify.sanitize(rawHtml))}</div>`;
  }

  private renderContent(content: unknown) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((block: any) => {
        if (typeof block === "string") return block;
        if (block?.type === "text") return block.text ?? "";
        if (block?.type === "thinking") return "";
        if (block?.type === "toolCall") return `[tool call: ${block.name}]`;
        if (block?.type === "image") return "";
        return JSON.stringify(block);
      }).join("\n");
    }
    return content == null ? "" : JSON.stringify(content, null, 2);
  }

  private startEdit(entry: any) {
    this.editingEntryId = entry.id;
    this.editingDraft = this.messageDisplayText(entry.message);
  }

  private async copyMessage(message: any) {
    await navigator.clipboard.writeText(this.messageDisplayText(message));
  }

  private async saveEdit(entry: any) {
    if (!this.active || !this.editingDraft.trim()) return;
    const content = this.editingDraft.trim();
    this.editingEntryId = "";
    this.editingDraft = "";
    this.streamingContent = "";
    this.errorMessage = "";
    const response = await fetch(`${API}/api/sessions/${this.active.slug}/messages/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        model: this.selectedProvider && this.selectedModel ? { provider: this.selectedProvider, modelId: this.selectedModel } : undefined,
        thinkingLevel: this.thinkingLevel,
      }),
    });
    if (!response.ok) {
      this.errorMessage = await response.text();
      return;
    }
    await this.openSession(this.active);
  }

  private handleFileChange(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const incoming = Array.from(input.files ?? []);
    this.files = [...this.files, ...incoming];
    input.value = "";
  }

  private handleComposerKeydown(ev: KeyboardEvent) {
    if (ev.key !== "Enter" || ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    ev.preventDefault();
    const form = (ev.target as HTMLElement).closest("form");
    form?.requestSubmit();
  }

  private handleEditKeydown(ev: KeyboardEvent, entry: any) {
    if (ev.key !== "Enter" || ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    ev.preventDefault();
    void this.saveEdit(entry);
  }

  private async send(ev: Event) {
    ev.preventDefault();
    if (!this.active || !this.draft.trim()) return;
    const content = this.draft;
    const files = this.files;
    this.draft = "";
    this.files = [];
    this.shouldScrollToBottom = true;

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
      <div class="layout ${this.sidebarCollapsed ? "sidebar-collapsed" : ""}">
        <aside>
          <div class="brand"><h2>Memoryhold</h2><button class="sidebar-toggle" title="Hide sidebar" @click=${() => this.sidebarCollapsed = true}>◫</button></div>
          <button class="new-btn" @click=${this.newSession}><span class="side-icon">✎</span><span>New chat</span></button>
          <button class="nav-btn ${this.view === "settings" ? "active" : ""}" @click=${() => this.view = "settings"}><span class="side-icon">⚙</span><span>Settings</span></button>
          <section>
            <h3>Recents</h3>
            <div class="session-list">
              ${this.sessions.map((s) => html`<div class="session ${this.active?.slug === s.slug ? "active" : ""}" @click=${() => this.openSession(s)}><div class="session-title">${s.title}</div></div>`)}
            </div>
          </section>
        </aside>
        <main>
          <header class="topbar">
            <div class="topbar-left">
              ${this.sidebarCollapsed ? html`<button class="sidebar-toggle" title="Show sidebar" @click=${() => this.sidebarCollapsed = false}>◫</button>` : ""}
              <div class="chat-title"><strong>${this.view === "settings" ? "Settings" : this.active?.title ?? "No conversation selected"}</strong><small>${this.view === "settings" ? "Accounts, providers, and defaults" : `${this.selectedProvider}${this.selectedModel ? ` / ${this.selectedModel}` : ""}`}</small></div>
            </div>
            <div class="status-pill">${this.isStreaming ? "Streaming" : "Ready"}</div>
          </header>
          ${this.errorMessage ? html`<div class="error-banner">${this.errorMessage}</div>` : ""}
          ${this.view === "settings" ? html`
            <div class="settings">
              <div class="settings-inner">
                <div class="settings-hero"><h1>Settings</h1><p class="muted">Connect provider accounts and choose the default model for new messages.</p></div>
                <section class="settings-card">
                  <h2>Accounts</h2>
                  <p>Credentials are stored on the backend in your local conversations directory.</p>
                  <div class="account-list">
                    ${this.oauthProviders.map((p) => html`<div class="account-row"><div><div class="account-name">${p.name}</div><div class="account-status">${p.authenticated ? "Connected" : "Not connected"}</div></div><button class=${p.authenticated ? "success" : "secondary"} @click=${() => this.startOAuth(p.id)}>${p.authenticated ? "Reconnect" : "Connect"}</button></div>`)}
                  </div>
                  ${this.loginId ? html`
                    <p style="margin-top:14px"><small>Browser opened. If callback does not complete, paste redirect URL/code:</small></p>
                    <textarea class="oauth-textarea" .value=${this.callbackInput} @input=${(e: InputEvent) => this.callbackInput = (e.target as HTMLTextAreaElement).value}></textarea>
                    <button @click=${this.completeOAuth}>Complete login</button>
                  ` : ""}
                </section>
                <section class="settings-card">
                  <h2>Model defaults</h2>
                  <p>These settings are sent with each message and recorded in the conversation timeline.</p>
                  <div class="settings-grid">
                    <select .value=${this.selectedProvider} @change=${(e: Event) => this.selectProvider((e.target as HTMLSelectElement).value)}>
                      ${this.providers.map((p) => html`<option value=${p.id} ?selected=${p.id === this.selectedProvider}>${p.id}</option>`)}
                    </select>
                    <select .value=${this.selectedModel} @change=${(e: Event) => this.selectModel((e.target as HTMLSelectElement).value)}>
                      ${this.providers.find((p) => p.id === this.selectedProvider)?.models.map((m) => html`<option value=${m.id} ?selected=${m.id === this.selectedModel}>${m.name || m.id}</option>`) ?? []}
                    </select>
                    <select .value=${this.thinkingLevel} @change=${(e: Event) => this.selectThinkingLevel((e.target as HTMLSelectElement).value)}>
                      ${["off", "minimal", "low", "medium", "high"].map((level) => html`<option value=${level} ?selected=${level === this.thinkingLevel}>thinking: ${level}</option>`) }
                    </select>
                  </div>
                </section>
              </div>
            </div>` : html`
            <div class="messages">
              ${this.active ? html`<div class="thread">
                ${this.entries.map((e: any) => {
                  if (e.type === "message") {
                    const role = e.message.role === "toolResult" ? "tool" : e.message.role;
                    const isEditing = this.editingEntryId === e.id;
                    const classes = `msg ${role} ${e.message.stopReason === "error" ? "error" : ""} ${isEditing ? "editing" : ""}`;
                    const label = `${role}${e.message.stopReason === "error" ? " · error" : ""}`;
                    const avatar = role === "user" ? "U" : role === "tool" ? "T" : "M";
                    return html`<div class=${classes}><div class="avatar">${avatar}</div><div class="message-body"><div class="role">${label}</div><div class="bubble">${isEditing ? html`
                      <div class="edit-box">
                        ${this.renderAttachments(this.messageAttachments(e.message))}
                        <textarea class="edit-textarea" .value=${this.editingDraft} @keydown=${(ev: KeyboardEvent) => this.handleEditKeydown(ev, e)} @input=${(ev: InputEvent) => this.editingDraft = (ev.target as HTMLTextAreaElement).value}></textarea>
                        <div class="edit-actions"><button class="cancel" @click=${() => this.editingEntryId = ""}>Cancel</button><button class="save" @click=${() => this.saveEdit(e)}>Send</button></div>
                      </div>
                    ` : html`${this.renderAttachments(this.messageAttachments(e.message))}${this.renderMessage(e.message)}`}</div>${role === "user" && !isEditing ? html`<div class="message-actions"><button class="action-btn" title="Copy" @click=${() => this.copyMessage(e.message)}>⧉</button><button class="action-btn" title="Edit" @click=${() => this.startEdit(e)}>✎</button></div>` : ""}</div></div>`;
                  }
                  if (e.type === "model_change" || e.type === "thinking_level_change") return "";
                  return "";
                })}
                ${this.isStreaming || this.streamingContent ? html`<div class="msg assistant"><div class="avatar">M</div><div class="message-body"><div class="role">assistant · streaming</div><div class="bubble">${this.streamingContent ? this.renderMarkdown(this.streamingContent) : this.renderThinkingIndicator("Thinking")}</div></div></div>` : ""}
              </div>` : html`<div class="empty"><h1>Your local AI memory.</h1><p>Create or select a conversation to start chatting.</p></div>`}
            </div>
            <form @submit=${this.send}>
              ${this.renderSelectedFiles()}
              <div class="composer ${this.files.length ? "with-files" : ""}">
                <textarea .value=${this.draft} @keydown=${this.handleComposerKeydown} @input=${(e: InputEvent) => this.draft = (e.target as HTMLTextAreaElement).value} placeholder="Message Memoryhold..."></textarea>
                <button class="send-btn" title=${this.isStreaming ? "Queue message" : "Send message"}>${this.isStreaming ? "Queue" : "Send"}</button>
                <div class="composer-extra">
                  <label class="file-label">＋ Attach<input type="file" multiple @change=${this.handleFileChange} /></label>
                  ${this.files.length ? html`<span>${this.files.length} file${this.files.length === 1 ? "" : "s"} selected</span>` : html`<span>No files attached</span>`}
                </div>
              </div>
            </form>`}
        </main>
      </div>
    `;
  }
}

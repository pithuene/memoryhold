import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Copy,
  Edit3,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import type { SessionMetadata, SessionTreeEntry } from "@memoryhold/shared";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import DOMPurify from "dompurify";
import "katex/dist/katex.min.css";
import {
  ANDROID_EMULATOR_API_BASE_URL,
  DEFAULT_API_BASE_URL,
  MemoryholdApi,
  initialBackendToken,
  initialBackendUrl,
  isCapacitorRuntime,
  normalizeApiBaseUrl,
  saveBackendToken,
  saveBackendUrl,
  validateApiBaseUrl,
  type HealthResult,
  type Provider,
} from "./api";
import {
  attachmentIcon,
  attachmentKind,
  displayText,
  isImage,
  messageAttachments,
  shouldShowMessage,
} from "./message-utils";
import { savedModelSettings, saveModelSettings } from "./settings";
import "./styles.css";

marked.use(
  markedKatex({ throwOnError: false, displayMode: false, nonStandard: true }),
);

type View = "chat" | "settings";

function cn(...items: Array<string | false | undefined>) {
  return items.filter(Boolean).join(" ");
}
function slugFromUrl() {
  return decodeURIComponent(
    window.location.pathname.match(/^\/c\/([^/]+)\/?$/)?.[1] ?? "",
  );
}
function readableError(message: string) {
  const match = message.match(/^(.*?):\s*(\{[\s\S]*\})\s*$/);
  if (!match) return message;
  try {
    const parsed = JSON.parse(match[2]);
    return `${match[1]}: ${parsed?.error?.message ?? parsed?.message ?? message}`;
  } catch {
    return message;
  }
}
function markdownHtml(markdown: string) {
  const normalized = markdown
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, f) => `\n$$\n${f.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, f) => `$${f.trim()}$`);
  return DOMPurify.sanitize(
    marked.parse(normalized, { async: false }) as string,
  );
}
function App() {
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [active, setActive] = useState<SessionMetadata>();
  const [entries, setEntries] = useState<SessionTreeEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState("off");
  const [oauthProviders, setOauthProviders] = useState<
    Array<{ id: string; name: string; authenticated: boolean }>
  >([]);
  const [loginId, setLoginId] = useState("");
  const [callbackInput, setCallbackInput] = useState("");
  const [view, setView] = useState<View>("chat");
  const [apiBaseUrl, setApiBaseUrl] = useState(initialBackendUrl);
  const [apiToken, setApiToken] = useState(initialBackendToken);
  const mobileRuntime = isCapacitorRuntime();
  const [connectionStatus, setConnectionStatus] = useState<
    HealthResult | undefined
  >();
  const [connectionCheckedAt, setConnectionCheckedAt] = useState<string>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState("");
  const [editingDraft, setEditingDraft] = useState("");
  const [renamingSlug, setRenamingSlug] = useState("");
  const [renamingTitle, setRenamingTitle] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<SessionMetadata>();
  const eventSource = useRef<EventSource | undefined>(undefined);
  const messagesRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<SessionMetadata | undefined>(undefined);
  activeRef.current = active;
  const showError = (message: string) =>
    setErrorMessage(readableError(message));
  const api = useMemo(
    () => new MemoryholdApi(apiBaseUrl, apiToken),
    [apiBaseUrl, apiToken],
  );

  const loadSessions = async () => setSessions(await api.sessions());
  const loadOAuth = async () => setOauthProviders(await api.oauthProviders());

  const openSession = async (
    session: SessionMetadata,
    updateHistory = true,
    force = false,
  ) => {
    if (renamingSlug && !force) return;
    eventSource.current?.close();
    setStreamingContent("");
    setIsStreaming(false);
    setErrorMessage("");
    setActive(session);
    setView("chat");
    if (updateHistory)
      window.history.pushState(
        {},
        "",
        `/c/${encodeURIComponent(session.slug)}`,
      );
    const data = await api.session(session.slug);
    setEntries(data.entries);
    requestAnimationFrame(() =>
      messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight }),
    );
    const es = new EventSource(api.eventsUrl(session.slug));
    eventSource.current = es;
    es.onmessage = (msg) => {
      const event = JSON.parse(msg.data);
      if (event.type === "entry_appended") {
        setStreamingContent("");
        setEntries((e) => [...e, event.entry]);
      }
      if (event.type === "message_update") setStreamingContent(event.content);
      if (event.type === "stream_status") {
        setIsStreaming(event.isStreaming);
        if (!event.isStreaming && activeRef.current)
          setTimeout(() => openSession(activeRef.current!, false), 0);
      }
      if (event.type === "error") showError(event.message);
      if (event.type === "session_updated") {
        setActive(event.metadata);
        void loadSessions();
      }
    };
  };

  useEffect(() => {
    document.documentElement.classList.toggle(
      "electron",
      new URLSearchParams(location.search).get("memoryholdElectron") === "1",
    );
    const pop = () => {
      const s = sessions.find((x) => x.slug === slugFromUrl());
      if (s) void openSession(s, false);
    };
    addEventListener("popstate", pop);
    return () => {
      removeEventListener("popstate", pop);
      eventSource.current?.close();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const health = await api.health();
      if (cancelled) return;
      setConnectionStatus(health);
      if (health.ok) setConnectionCheckedAt(new Date().toISOString());
      if (!health.ok) {
        showError(
          `Cannot reach Memoryhold server at ${health.url}: ${health.error}`,
        );
        return;
      }
      try {
        const [ss, oauth, ps] = await Promise.all([
          api.sessions(),
          api.oauthProviders(),
          api.providers(),
        ]);
        if (cancelled) return;
        setSessions(ss);
        setOauthProviders(oauth);
        setProviders(ps);
        const saved = savedModelSettings();
        const p =
          (saved.provider &&
            ps.find((x: Provider) => x.id === saved.provider)) ||
          ps.find((x: Provider) => x.id === "openai-codex") ||
          ps.find((x: Provider) => x.id === "openai") ||
          ps[0];
        const model =
          p?.models.find((m: any) => m.id === saved.modelId)?.id ??
          p?.models[0]?.id ??
          "";
        setSelectedProvider(p?.id ?? "");
        setSelectedModel(model);
        setThinkingLevel(saved.thinkingLevel ?? "off");
      } catch (error) {
        if (!cancelled)
          showError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, apiToken]);

  useEffect(() => {
    const slug = slugFromUrl();
    if (slug && !active && sessions.length) {
      const s = sessions.find((x) => x.slug === slug);
      if (s) void openSession(s, false);
    }
  }, [sessions]);
  useEffect(() => {
    saveModelSettings(selectedProvider, selectedModel, thinkingLevel);
  }, [selectedProvider, selectedModel, thinkingLevel]);
  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
  }, [entries, streamingContent]);
  useEffect(() => {
    if (renamingSlug) renameRef.current?.select();
  }, [renamingSlug]);
  useEffect(() => {
    if (!errorMessage) return;
    const timeout = window.setTimeout(() => setErrorMessage(""), 12000);
    return () => window.clearTimeout(timeout);
  }, [errorMessage]);
  useEffect(() => {
    const appPlugin = (window as any).Capacitor?.Plugins?.App;
    if (!mobileRuntime || !appPlugin?.addListener) return;
    let handle: { remove?: () => Promise<void> | void } | undefined;
    void appPlugin
      .addListener("backButton", () => {
        if (mobileSidebarOpen) return setMobileSidebarOpen(false);
        if (deleteCandidate) return setDeleteCandidate(undefined);
        if (view === "settings") return setView("chat");
        void appPlugin.exitApp?.();
      })
      .then((h: any) => {
        handle = h;
      });
    return () => {
      void handle?.remove?.();
    };
  }, [mobileRuntime, mobileSidebarOpen, deleteCandidate, view]);

  const newSession = async () => {
    const metadata = await api.createSession();
    await loadSessions();
    await openSession(metadata);
  };
  const saveRename = async (session: SessionMetadata) => {
    const title = renamingTitle.trim();
    if (!title || title === session.title) {
      setRenamingSlug("");
      return;
    }
    try {
      const m = await api.renameSession(session.slug, title);
      setSessions((ss) =>
        ss.map((x) => (x.slug === session.slug || x.slug === m.slug ? m : x)),
      );
      setRenamingSlug("");
      if (active?.slug === session.slug) await openSession(m, true, true);
      else await loadSessions();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  };
  const confirmDelete = async () => {
    if (!deleteCandidate) return;
    try {
      await api.deleteSession(deleteCandidate.slug);
      setSessions((ss) => ss.filter((x) => x.slug !== deleteCandidate.slug));
      if (active?.slug === deleteCandidate.slug) {
        eventSource.current?.close();
        setActive(undefined);
        setEntries([]);
        window.history.pushState({}, "", "/");
      }
      setDeleteCandidate(undefined);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  };
  const startOAuth = async (id: string) => {
    setErrorMessage("");
    const result = await api.startOAuth(id);
    if (result.error) return showError(result.error);
    setLoginId(result.loginId);
    if (result.authUrl) {
      const browser = (window as any).Capacitor?.Plugins?.Browser;
      if (mobileRuntime && browser?.open)
        await browser.open({ url: result.authUrl });
      else window.open(result.authUrl, "_blank");
    }
  };
  const completeOAuth = async () => {
    if (!loginId || !callbackInput.trim()) return;
    await api.completeOAuth(loginId, callbackInput);
    for (let i = 0; i < 30; i++) {
      const s = await api.oauthStatus(loginId);
      if (s.status === "done") {
        setLoginId("");
        setCallbackInput("");
        await loadOAuth();
        return;
      }
      if (s.status === "error") return showError(s.error);
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  const send = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!active || !draft.trim()) return;
    setErrorMessage("");
    const content = draft;
    const outgoing = files;
    setDraft("");
    setFiles([]);
    try {
      let attachments: any[] = [];
      if (outgoing.length)
        attachments = (await api.uploadAttachments(active.slug, outgoing))
          .attachments;
      await api.sendMessage(active.slug, {
        content,
        attachments,
        model:
          selectedProvider && selectedModel
            ? { provider: selectedProvider, modelId: selectedModel }
            : undefined,
        thinkingLevel,
      });
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  };
  const saveEdit = async (entry: any) => {
    if (!active || !editingDraft.trim()) return;
    try {
      await api.editMessage(active.slug, entry.id, {
        content: editingDraft.trim(),
        model:
          selectedProvider && selectedModel
            ? { provider: selectedProvider, modelId: selectedModel }
            : undefined,
        thinkingLevel,
      });
      setEditingEntryId("");
      setEditingDraft("");
      await openSession(active, false);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div
      className={cn(
        "app",
        sidebarCollapsed && "collapsed",
        mobileSidebarOpen && "mobile-sidebar-open",
      )}
    >
      <aside className="sidebar">
        <div className="brand">
          <h2>Memoryhold</h2>
          <button
            className="icon ghost"
            onClick={() => setSidebarCollapsed(true)}
          >
            <PanelLeftClose size={18} />
          </button>
        </div>
        <button
          className="nav"
          onClick={async () => {
            await newSession();
            setMobileSidebarOpen(false);
          }}
        >
          <Plus size={18} />
          New chat
        </button>
        <button
          className={cn("nav", view === "settings" && "active")}
          onClick={() => {
            setView("settings");
            setMobileSidebarOpen(false);
          }}
        >
          <Settings size={18} />
          Settings
        </button>
        <h3>Recents</h3>
        <div className="session-list">
          {sessions.map((s) => (
            <ContextMenu.Root key={s.slug}>
              <ContextMenu.Trigger asChild>
                <div
                  onClick={() => {
                    void openSession(s);
                    setMobileSidebarOpen(false);
                  }}
                  className={cn("session", active?.slug === s.slug && "active")}
                >
                  {renamingSlug === s.slug ? (
                    <input
                      ref={renameRef}
                      className="rename-input"
                      value={renamingTitle}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenamingTitle(e.target.value)}
                      onBlur={() => saveRename(s)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveRename(s);
                        if (e.key === "Escape") setRenamingSlug("");
                      }}
                    />
                  ) : (
                    <>
                      <span>{s.title}</span>
                      <div className="mobile-session-actions">
                        <button
                          type="button"
                          aria-label="Rename"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingSlug(s.slug);
                            setRenamingTitle(s.title);
                          }}
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteCandidate(s);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content className="menu">
                  <ContextMenu.Item
                    className="menu-item"
                    onSelect={() => {
                      setRenamingSlug(s.slug);
                      setRenamingTitle(s.title);
                    }}
                  >
                    <Edit3 size={15} />
                    Rename
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className="menu-item danger"
                    onSelect={() => setDeleteCandidate(s)}
                  >
                    <Trash2 size={15} />
                    Delete
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          ))}
        </div>
      </aside>
      <button
        className="sidebar-backdrop"
        aria-label="Close sidebar"
        onClick={() => setMobileSidebarOpen(false)}
      />
      <main className="main">
        <header className="topbar">
          <div className="top-left">
            <button
              className="icon ghost mobile-menu"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu size={18} />
            </button>
            {sidebarCollapsed && (
              <button
                className="icon ghost desktop-only"
                onClick={() => setSidebarCollapsed(false)}
              >
                <PanelLeftOpen size={18} />
              </button>
            )}
            <div>
              <strong>
                {view === "settings"
                  ? "Settings"
                  : (active?.title ?? "No conversation selected")}
              </strong>
              <small>
                {view === "settings"
                  ? "Accounts, providers, and defaults"
                  : `${selectedProvider}${selectedModel ? ` / ${selectedModel}` : ""}`}
              </small>
            </div>
          </div>
          <span className="status">{isStreaming ? "Streaming" : "Ready"}</span>
        </header>
        {errorMessage && (
          <div className="error" role="alert">
            <span>{errorMessage}</span>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => setErrorMessage("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {view === "settings" ? (
          <SettingsView
            oauthProviders={oauthProviders}
            startOAuth={startOAuth}
            loginId={loginId}
            callbackInput={callbackInput}
            setCallbackInput={setCallbackInput}
            completeOAuth={completeOAuth}
            providers={providers}
            selectedProvider={selectedProvider}
            setSelectedProvider={(p: string) => {
              setSelectedProvider(p);
              setSelectedModel(
                providers.find((x) => x.id === p)?.models[0]?.id ?? "",
              );
            }}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            thinkingLevel={thinkingLevel}
            setThinkingLevel={setThinkingLevel}
            mobileRuntime={mobileRuntime}
            apiBaseUrl={apiBaseUrl}
            apiToken={apiToken}
            setApiToken={setApiToken}
            connectionStatus={connectionStatus}
            connectionCheckedAt={connectionCheckedAt}
            setConnectionStatus={setConnectionStatus}
            setConnectionCheckedAt={setConnectionCheckedAt}
            saveBackend={(url: string) => {
              const error = validateApiBaseUrl(url);
              if (error) return showError(error);
              const normalized = normalizeApiBaseUrl(url);
              saveBackendUrl(normalized);
              setApiBaseUrl(normalized || DEFAULT_API_BASE_URL);
              setSessions([]);
              setActive(undefined);
              setEntries([]);
              eventSource.current?.close();
            }}
            saveToken={(token: string) => {
              saveBackendToken(token);
              setApiToken(token.trim());
              setSessions([]);
              setActive(undefined);
              setEntries([]);
              eventSource.current?.close();
            }}
          />
        ) : (
          <>
            <div className="messages" ref={messagesRef}>
              {!active && connectionStatus && !connectionStatus.ok ? (
                <ConnectionEmpty
                  status={connectionStatus}
                  openSettings={() => setView("settings")}
                />
              ) : active ? (
                <div className="thread">
                  {entries.map((e: any) =>
                    shouldShowMessage(e) ? (
                      <Message
                        key={e.id}
                        entry={e}
                        active={active}
                        api={api}
                        editing={editingEntryId === e.id}
                        editingDraft={editingDraft}
                        setEditingDraft={setEditingDraft}
                        saveEdit={saveEdit}
                        cancelEdit={() => setEditingEntryId("")}
                        startEdit={() => {
                          setEditingEntryId(e.id);
                          setEditingDraft(displayText(e.message));
                        }}
                      />
                    ) : null,
                  )}
                  {(isStreaming || streamingContent) && (
                    <div className="msg assistant">
                      <Avatar>M</Avatar>
                      <div className="message-body">
                        <div className="role">assistant · streaming</div>
                        <div className="bubble">
                          {streamingContent ? (
                            <Markdown text={streamingContent} />
                          ) : (
                            <Thinking />
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty">
                  <h1>Your local AI memory.</h1>
                  <p>Create or select a conversation to start chatting.</p>
                </div>
              )}
            </div>
            <form className="composer" onSubmit={send}>
              {!!files.length && (
                <div className="selected-files">
                  {files.map((file, i) => (
                    <div className="selected-file" key={`${file.name}-${i}`}>
                      {file.type.startsWith("image/") ? (
                        <img src={URL.createObjectURL(file)} />
                      ) : (
                        <b>{attachmentIcon(file.name)}</b>
                      )}
                      <div>
                        <strong>{file.name}</strong>
                        <small>{attachmentKind(file.name, file.type)}</small>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setFiles(files.filter((_, x) => x !== i))
                        }
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="composer-box">
                <label className="attach">
                  <Paperclip size={19} />
                  <input
                    type="file"
                    multiple
                    onChange={(e) => {
                      setFiles([...files, ...Array.from(e.target.files ?? [])]);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.metaKey &&
                      !e.ctrlKey &&
                      !e.altKey
                    ) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={
                    active
                      ? "Message Memoryhold"
                      : "Create or select a conversation"
                  }
                />
                <button type="submit" disabled={!active || !draft.trim()}>
                  Send
                </button>
              </div>
            </form>
          </>
        )}
      </main>
      <Dialog.Root
        open={!!deleteCandidate}
        onOpenChange={(o) => !o && setDeleteCandidate(undefined)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog">
            <Dialog.Title>Delete conversation?</Dialog.Title>
            <Dialog.Description>
              This will permanently delete “{deleteCandidate?.title}” and its
              attachments from the conversations folder.
            </Dialog.Description>
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button className="button secondary">Cancel</button>
              </Dialog.Close>
              <button className="button destructive" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function SettingsView(props: any) {
  const [backendDraft, setBackendDraft] = useState(props.apiBaseUrl);
  const [tokenDraft, setTokenDraft] = useState(props.apiToken ?? "");
  const [checking, setChecking] = useState(false);
  useEffect(() => setBackendDraft(props.apiBaseUrl), [props.apiBaseUrl]);
  useEffect(() => setTokenDraft(props.apiToken ?? ""), [props.apiToken]);
  const testConnection = async () => {
    const validation = validateApiBaseUrl(backendDraft);
    if (validation)
      return props.setConnectionStatus({
        ok: false,
        url: backendDraft,
        error: validation,
      });
    setChecking(true);
    const api = new MemoryholdApi(backendDraft, tokenDraft);
    const health = await api.health();
    if (!health.ok) {
      props.setConnectionStatus(health);
      setChecking(false);
      return;
    }
    try {
      await api.sessions();
      props.setConnectionStatus(health);
      props.setConnectionCheckedAt(new Date().toISOString());
    } catch (error) {
      props.setConnectionStatus({
        ok: false,
        url: health.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    setChecking(false);
  };
  const mode = props.mobileRuntime
    ? "Android remote client"
    : new URLSearchParams(location.search).get("memoryholdElectron") === "1"
      ? "Electron client"
      : "Web client";
  return (
    <div className="settings-page">
      <div className="settings-inner">
        <div className="settings-hero">
          <h1>Settings</h1>
          <p>
            Connect provider accounts and choose the default model for new
            messages.
          </p>
        </div>
        <section className="card">
          <h2>Server connection</h2>
          <p>
            {props.mobileRuntime
              ? "Android devices cannot use desktop localhost. Use the emulator address, your server machine’s LAN IP, or a VPN/HTTPS URL."
              : "Choose which Memoryhold backend this client should use."}
          </p>
          <div className="connection-meta">
            <small>Mode: {mode}</small>
            {props.connectionCheckedAt && (
              <small>
                Last connected:{" "}
                {new Date(props.connectionCheckedAt).toLocaleString()}
              </small>
            )}
          </div>
          <div className="connection-row">
            <input
              className="backend-input"
              value={backendDraft}
              onChange={(e) => setBackendDraft(e.target.value)}
              placeholder="http://localhost:8787"
            />
            <div className="connection-actions">
              <button
                className="button secondary"
                onClick={testConnection}
                disabled={checking}
              >
                {checking ? "Checking…" : "Test"}
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  setBackendDraft(
                    props.mobileRuntime
                      ? ANDROID_EMULATOR_API_BASE_URL
                      : DEFAULT_API_BASE_URL,
                  )
                }
              >
                Reset
              </button>
              <button
                className="button"
                onClick={() => {
                  props.saveBackend(backendDraft);
                  props.saveToken(tokenDraft);
                }}
              >
                Save
              </button>
            </div>
          </div>
          <label className="token-field">
            <span>
              Access token{" "}
              <small>
                Only needed when the server sets{" "}
                <code>MEMORYHOLD_ACCESS_TOKEN</code>.
              </small>
            </span>
            <input
              className="backend-input"
              type="password"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="optional"
            />
          </label>
          <small>
            Examples: local web <code>{DEFAULT_API_BASE_URL}</code>, Android
            emulator <code>{ANDROID_EMULATOR_API_BASE_URL}</code>, phone on LAN{" "}
            <code>http://192.168.1.23:8787</code>.
          </small>
          {props.connectionStatus && (
            <p
              className={cn(
                "connection-status",
                props.connectionStatus.ok ? "ok" : "bad",
              )}
            >
              {props.connectionStatus.ok
                ? `Connected to ${props.connectionStatus.url}${props.connectionStatus.authRequired ? " · token required" : ""}`
                : `Cannot connect to ${props.connectionStatus.url}: ${props.connectionStatus.error}`}
            </p>
          )}
        </section>
        <section className="card">
          <h2>Accounts</h2>
          <p>
            Credentials are stored on the backend in your conversations
            directory.
          </p>
          {props.oauthProviders.map((p: any) => (
            <div className="account-row" key={p.id}>
              <div>
                <strong>{p.name}</strong>
                <small>{p.authenticated ? "Connected" : "Not connected"}</small>
              </div>
              <button
                className={cn(
                  "button",
                  p.authenticated ? "success" : "secondary",
                )}
                onClick={() => props.startOAuth(p.id)}
              >
                {p.authenticated ? "Reconnect" : "Connect"}
              </button>
            </div>
          ))}
          {props.loginId && (
            <>
              <p>
                <small>
                  Browser opened. If callback does not complete, paste redirect
                  URL/code:
                </small>
              </p>
              <textarea
                className="oauth-textarea"
                value={props.callbackInput}
                onChange={(e) => props.setCallbackInput(e.target.value)}
              />
              <button className="button" onClick={props.completeOAuth}>
                Complete login
              </button>
            </>
          )}
        </section>
        <section className="card">
          <h2>Model defaults</h2>
          <p>
            These settings are sent with each message and recorded in the
            conversation timeline.
          </p>
          <div className="settings-grid">
            <select
              value={props.selectedProvider}
              onChange={(e) => props.setSelectedProvider(e.target.value)}
            >
              {props.providers.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.id}
                </option>
              ))}
            </select>
            <select
              value={props.selectedModel}
              onChange={(e) => props.setSelectedModel(e.target.value)}
            >
              {props.providers
                .find((p: any) => p.id === props.selectedProvider)
                ?.models.map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id}
                  </option>
                ))}
            </select>
            <select
              value={props.thinkingLevel}
              onChange={(e) => props.setThinkingLevel(e.target.value)}
            >
              {["off", "minimal", "low", "medium", "high"].map((l) => (
                <option key={l} value={l}>
                  thinking: {l}
                </option>
              ))}
            </select>
          </div>
        </section>
      </div>
    </div>
  );
}
function ConnectionEmpty({
  status,
  openSettings,
}: {
  status: Extract<HealthResult, { ok: false }>;
  openSettings: () => void;
}) {
  return (
    <div className="empty connection-empty">
      <h1>Connect to Memoryhold server.</h1>
      <p>
        Cannot reach {status.url}: {status.error}
      </p>
      <button className="button" onClick={openSettings}>
        Open connection settings
      </button>
    </div>
  );
}
function Avatar({ children }: { children: React.ReactNode }) {
  return <div className="avatar">{children}</div>;
}
function Markdown({ text }: { text: string }) {
  return (
    <div
      className="markdown"
      dangerouslySetInnerHTML={{ __html: markdownHtml(text) }}
    />
  );
}
function Thinking() {
  return (
    <div className="thinking">
      Thinking <span />
      <span />
      <span />
    </div>
  );
}
function Attachments({
  attachments,
  active,
  api,
}: {
  attachments: any[];
  active?: SessionMetadata;
  api: MemoryholdApi;
}) {
  if (!attachments.length) return null;
  return (
    <div className="attachment-list">
      {attachments.map((a, i) => (
        <div className="attachment-chip" key={i}>
          {isImage(a) && active ? (
            <img src={api.attachmentUrl(active.slug, a.relativePath)} />
          ) : (
            <b>{attachmentIcon(a.filename)}</b>
          )}
          <div>
            <strong>{a.filename ?? "Attachment"}</strong>
            <small>{attachmentKind(a.filename, a.mimeType)}</small>
          </div>
        </div>
      ))}
    </div>
  );
}
function Message({
  entry,
  active,
  api,
  editing,
  editingDraft,
  setEditingDraft,
  saveEdit,
  cancelEdit,
  startEdit,
}: any) {
  const role =
    entry.message.role === "toolResult" ? "tool" : entry.message.role;
  const text = displayText(entry.message);
  return (
    <div
      className={cn(
        "msg",
        role,
        entry.message.stopReason === "error" && "error-msg",
        editing && "editing",
      )}
    >
      <Avatar>{role === "user" ? "U" : role === "tool" ? "T" : "M"}</Avatar>
      <div className="message-body">
        <div className="role">
          {role}
          {entry.message.stopReason === "error" ? " · error" : ""}
        </div>
        <div className="bubble">
          {editing ? (
            <div className="edit-box">
              <Attachments
                attachments={messageAttachments(entry.message)}
                active={active}
                api={api}
              />
              <textarea
                value={editingDraft}
                onChange={(e) => setEditingDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.metaKey &&
                    !e.ctrlKey &&
                    !e.altKey
                  ) {
                    e.preventDefault();
                    saveEdit(entry);
                  }
                }}
              />
              <div className="edit-actions">
                <button className="button secondary" onClick={cancelEdit}>
                  Cancel
                </button>
                <button className="button" onClick={() => saveEdit(entry)}>
                  Send
                </button>
              </div>
            </div>
          ) : (
            <>
              <Attachments
                attachments={messageAttachments(entry.message)}
                active={active}
                api={api}
              />
              <Markdown
                text={[
                  text,
                  entry.message.errorMessage
                    ? `Error: ${entry.message.errorMessage}`
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n\n")}
              />
            </>
          )}
        </div>
        {role === "user" && !editing && (
          <div className="message-actions">
            <button onClick={() => navigator.clipboard.writeText(text)}>
              <Copy size={15} />
            </button>
            <button onClick={startEdit}>
              <Edit3 size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

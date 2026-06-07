import { app, BrowserWindow, clipboard, dialog, Menu, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

interface DesktopConfig {
  conversationsDir?: string;
  backendMode?: "local" | "remote";
  remoteBackendUrl?: string;
  remoteBackendToken?: string;
}

let serverProcess: ChildProcess | undefined;
let webProcess: ChildProcess | undefined;
let mainWindow: BrowserWindow | undefined;
let activeConfig: DesktopConfig = {};

app.setName("Memoryhold");

const isDev = process.env.MEMORYHOLD_ELECTRON_DEV === "1" || !app.isPackaged;
const serverPort = Number(process.env.MEMORYHOLD_SERVER_PORT ?? 8787);
const webUrl = process.env.MEMORYHOLD_WEB_URL ?? `http://localhost:5173`;

function normalizeBackendUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function backendMode(config = activeConfig): "local" | "remote" {
  return process.env.MEMORYHOLD_REMOTE_URL || config.backendMode === "remote"
    ? "remote"
    : "local";
}

function remoteBackendUrl(config = activeConfig) {
  return normalizeBackendUrl(
    process.env.MEMORYHOLD_REMOTE_URL ?? config.remoteBackendUrl ?? "",
  );
}

function remoteBackendToken(config = activeConfig) {
  return (
    process.env.MEMORYHOLD_REMOTE_TOKEN ??
    process.env.MEMORYHOLD_ACCESS_TOKEN ??
    config.remoteBackendToken ??
    ""
  );
}

function localBackendUrl() {
  return `http://localhost:${serverPort}`;
}

function rendererApiUrl() {
  return backendMode() === "remote" ? remoteBackendUrl() : localBackendUrl();
}

function configPath() {
  return join(app.getPath("userData"), "desktop-config.json");
}

function readConfig(): DesktopConfig {
  try {
    return JSON.parse(readFileSync(configPath(), "utf8")) as DesktopConfig;
  } catch {
    return {};
  }
}

function writeConfig(config: DesktopConfig) {
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

async function chooseConversationsDir(): Promise<string | undefined> {
  app.focus({ steal: true });
  const result = await dialog.showOpenDialog({
    title: "Choose Memoryhold conversations folder",
    message:
      "Choose where Memoryhold should store local conversations and attachments.",
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Use this folder",
  });
  return result.canceled ? undefined : result.filePaths[0];
}

async function pickAndSwitchConversationsDir() {
  const selected = await chooseConversationsDir();
  if (!selected) return;
  activeConfig = {
    ...activeConfig,
    backendMode: "local",
    conversationsDir: selected,
  };
  writeConfig(activeConfig);
  await restartServer(selected);
  await loadRenderer();
}

async function getConversationsDir(): Promise<string> {
  const existing =
    process.env.CONVERSATIONS_DIR ?? activeConfig.conversationsDir;
  if (existing) return existing;

  const selected = await chooseConversationsDir();
  if (!selected) {
    app.quit();
    throw new Error("No conversations directory selected");
  }
  activeConfig = {
    ...activeConfig,
    backendMode: "local",
    conversationsDir: selected,
  };
  writeConfig(activeConfig);
  return selected;
}

function projectRoot() {
  return process.env.MEMORYHOLD_PROJECT_ROOT
    ? resolve(process.env.MEMORYHOLD_PROJECT_ROOT)
    : resolve(app.getAppPath(), "../..");
}

function iconPath() {
  return isDev
    ? join(projectRoot(), "apps/electron/assets/icon.png")
    : join(process.resourcesPath, "icon.png");
}

function spawnPnpm(args: string[], env = process.env) {
  return spawn("pnpm", args, {
    cwd: projectRoot(),
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}

function startWebDev() {
  if (!isDev || process.env.MEMORYHOLD_WEB_URL) return;
  webProcess = spawnPnpm(["--filter", "@memoryhold/web", "dev"]);
}

async function restartServer(conversationsDir: string) {
  serverProcess?.kill();
  serverProcess = undefined;
  startServer(conversationsDir);
  await waitForUrl(`${localBackendUrl()}/api/health`, "Memoryhold server");
}

function startServer(conversationsDir: string) {
  const env = {
    ...process.env,
    CONVERSATIONS_DIR: conversationsDir,
    PORT: String(serverPort),
  };
  if (isDev) {
    serverProcess = spawnPnpm(["--filter", "@memoryhold/server", "dev"], env);
  } else {
    const appBundlePath = join(process.resourcesPath, "app.asar");
    serverProcess = spawn(
      process.execPath,
      [join(appBundlePath, "apps", "server", "dist", "index.js")],
      {
        env: {
          ...env,
          ELECTRON_RUN_AS_NODE: "1",
          MEMORYHOLD_WEB_DIST: join(appBundlePath, "apps", "web", "dist"),
        },
        cwd: process.resourcesPath,
        stdio: "inherit",
      },
    );
  }
}

async function waitForUrl(url: string, label: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not start in time`);
}

async function loadRenderer() {
  if (!mainWindow) return;
  const apiUrl = rendererApiUrl();
  if (!apiUrl) {
    await dialog.showMessageBox({
      type: "warning",
      message: "No remote backend URL is configured.",
    });
    return;
  }
  if (isDev) {
    const url = new URL(webUrl);
    url.searchParams.set("memoryholdElectron", "1");
    url.searchParams.set("memoryholdApiUrl", apiUrl);
    if (backendMode() === "remote" && remoteBackendToken())
      url.searchParams.set("memoryholdToken", remoteBackendToken());
    await mainWindow.loadURL(url.toString());
    return;
  }
  if (backendMode() === "local") {
    await mainWindow.loadURL(
      `${localBackendUrl()}/?memoryholdElectron=1&memoryholdApiUrl=${encodeURIComponent(apiUrl)}`,
    );
    return;
  }
  await mainWindow.loadFile(
    join(
      process.resourcesPath,
      "app.asar",
      "apps",
      "web",
      "dist",
      "index.html",
    ),
    {
      query: {
        memoryholdElectron: "1",
        memoryholdApiUrl: apiUrl,
        ...(remoteBackendToken()
          ? { memoryholdToken: remoteBackendToken() }
          : {}),
      },
    },
  );
}

async function switchToRemoteFromClipboard() {
  const clipboardParts = clipboard.readText().trim().split(/\s+/);
  const url = normalizeBackendUrl(clipboardParts[0] ?? "");
  const token = clipboardParts[1] ?? "";
  if (!url) {
    await dialog.showMessageBox({
      type: "warning",
      message: "Clipboard does not contain a server URL.",
    });
    return;
  }
  const health = await fetch(`${url}/api/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!health) {
    const result = await dialog.showMessageBox({
      type: "warning",
      buttons: ["Use Anyway", "Cancel"],
      defaultId: 1,
      message: `Could not reach ${url}. Use it anyway?`,
    });
    if (result.response !== 0) return;
  }
  serverProcess?.kill();
  serverProcess = undefined;
  activeConfig = {
    ...activeConfig,
    backendMode: "remote",
    remoteBackendUrl: url,
    remoteBackendToken: token || activeConfig.remoteBackendToken,
  };
  writeConfig(activeConfig);
  await loadRenderer();
}

async function switchToLocalBackend() {
  activeConfig = { ...activeConfig, backendMode: "local" };
  writeConfig(activeConfig);
  const conversationsDir = await getConversationsDir();
  await restartServer(conversationsDir);
  await loadRenderer();
}

function installMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Folder…",
          accelerator: "CmdOrCtrl+O",
          click: () => void pickAndSwitchConversationsDir(),
        },
        {
          label: "Use Local Backend",
          click: () => void switchToLocalBackend(),
        },
        {
          label: "Connect to Server URL from Clipboard…",
          click: () => void switchToRemoteFromClipboard(),
        },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 1000,
    minWidth: 960,
    minHeight: 700,
    title: "Memoryhold",
    icon: iconPath(),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition:
      process.platform === "darwin" ? { x: 16, y: 18 } : undefined,
    webPreferences: {
      additionalArguments: ["--memoryhold-electron"],
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  await loadRenderer();
}

app.whenReady().then(async () => {
  activeConfig = readConfig();
  if (process.env.MEMORYHOLD_REMOTE_URL)
    activeConfig = {
      ...activeConfig,
      backendMode: "remote",
      remoteBackendUrl: process.env.MEMORYHOLD_REMOTE_URL,
      remoteBackendToken:
        process.env.MEMORYHOLD_REMOTE_TOKEN ??
        process.env.MEMORYHOLD_ACCESS_TOKEN ??
        activeConfig.remoteBackendToken,
    };
  installMenu();
  if (backendMode() === "local") {
    const conversationsDir = await getConversationsDir();
    startServer(conversationsDir);
    await waitForUrl(`${localBackendUrl()}/api/health`, "Memoryhold server");
  }
  startWebDev();
  if (isDev) await waitForUrl(webUrl, "Memoryhold web app");
  await createWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  serverProcess?.kill();
  webProcess?.kill();
});

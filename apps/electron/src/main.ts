import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

interface DesktopConfig {
  conversationsDir?: string;
}

let serverProcess: ChildProcess | undefined;
let webProcess: ChildProcess | undefined;
let mainWindow: BrowserWindow | undefined;

app.setName("Memoryhold");

const isDev = process.env.MEMORYHOLD_ELECTRON_DEV === "1" || !app.isPackaged;
const serverPort = Number(process.env.MEMORYHOLD_SERVER_PORT ?? 8787);
const webUrl = process.env.MEMORYHOLD_WEB_URL ?? `http://localhost:5173`;

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
    message: "Choose where Memoryhold should store local conversations and attachments.",
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Use this folder",
  });
  return result.canceled ? undefined : result.filePaths[0];
}

async function pickAndSwitchConversationsDir() {
  const selected = await chooseConversationsDir();
  if (!selected) return;
  writeConfig({ conversationsDir: selected });
  await restartServer(selected);
  if (mainWindow) {
    if (isDev) {
      const url = new URL(webUrl);
      url.searchParams.set("memoryholdElectron", "1");
      await mainWindow.loadURL(url.toString());
    } else {
      await waitForUrl(`http://localhost:${serverPort}/api/health`, "Memoryhold server");
      await mainWindow.loadURL(`http://localhost:${serverPort}/?memoryholdElectron=1`);
    }
  }
}

async function getConversationsDir(): Promise<string> {
  const existing = process.env.CONVERSATIONS_DIR ?? readConfig().conversationsDir;
  if (existing) return existing;

  const selected = await chooseConversationsDir();
  if (!selected) {
    app.quit();
    throw new Error("No conversations directory selected");
  }
  writeConfig({ conversationsDir: selected });
  return selected;
}

function projectRoot() {
  return process.env.MEMORYHOLD_PROJECT_ROOT ? resolve(process.env.MEMORYHOLD_PROJECT_ROOT) : resolve(app.getAppPath(), "../..");
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
  await waitForUrl(`http://localhost:${serverPort}/api/health`, "Memoryhold server");
}

function startServer(conversationsDir: string) {
  const env = { ...process.env, CONVERSATIONS_DIR: conversationsDir, PORT: String(serverPort) };
  if (isDev) {
    serverProcess = spawnPnpm(["--filter", "@memoryhold/server", "dev"], env);
  } else {
    serverProcess = spawn(process.execPath, [join(process.resourcesPath, "app", "apps", "server", "dist", "index.js")], {
      env: {
        ...env,
        ELECTRON_RUN_AS_NODE: "1",
        MEMORYHOLD_WEB_DIST: join(process.resourcesPath, "app", "apps", "web", "dist"),
      },
      cwd: join(process.resourcesPath, "app"),
      stdio: "inherit",
    });
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
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 16, y: 18 } : undefined,
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

  if (isDev) {
    const url = new URL(webUrl);
    url.searchParams.set("memoryholdElectron", "1");
    await mainWindow.loadURL(url.toString());
  } else {
    await mainWindow.loadURL(`http://localhost:${serverPort}/?memoryholdElectron=1`);
  }
}

app.whenReady().then(async () => {
  installMenu();
  const conversationsDir = await getConversationsDir();
  startServer(conversationsDir);
  startWebDev();
  await waitForUrl(`http://localhost:${serverPort}/api/health`, "Memoryhold server");
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

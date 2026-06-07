import {
  rmSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { packager } from "@electron/packager";
import { build as esbuild } from "esbuild";

const root = resolve(process.cwd(), "../..");
const staging = join(process.cwd(), "tmp", "package-app");
const release = join(root, "release");
const arch = process.arch === "arm64" ? "arm64" : "x64";
const libc = process.report.getReport().header.glibcVersionRuntime
  ? "gnu"
  : "musl";
const canvasBinaryName = `canvas-linux-${arch}-${libc}`;

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("pnpm", ["--filter", "@memoryhold/shared", "build"]);
run("pnpm", ["--filter", "@memoryhold/web", "build"]);
run("pnpm", ["--filter", "@memoryhold/electron", "build"]);

rmSync(staging, { recursive: true, force: true });
rmSync(release, { recursive: true, force: true });
mkdirSync(join(staging, "dist"), { recursive: true });
mkdirSync(join(staging, "apps/server/dist"), { recursive: true });
mkdirSync(release, { recursive: true });

cpSync(join(process.cwd(), "dist"), join(staging, "dist"), { recursive: true });
cpSync(join(root, "apps/web/dist"), join(staging, "apps/web/dist"), {
  recursive: true,
});
cpSync(join(process.cwd(), "assets/icon.png"), join(staging, "icon.png"));

const canvasPackage = realpathSync(
  join(root, "apps/server/node_modules/@napi-rs/canvas"),
);
const canvasBinaryPackage = realpathSync(
  join(
    root,
    `node_modules/.pnpm/@napi-rs+${canvasBinaryName}@1.0.0/node_modules/@napi-rs/${canvasBinaryName}`,
  ),
);
mkdirSync(join(staging, "node_modules/@napi-rs"), { recursive: true });
cpSync(canvasPackage, join(staging, "node_modules/@napi-rs/canvas"), {
  recursive: true,
});
cpSync(
  canvasBinaryPackage,
  join(staging, `node_modules/@napi-rs/${canvasBinaryName}`),
  { recursive: true },
);

await esbuild({
  entryPoints: [join(root, "apps/server/src/index.ts")],
  outfile: join(staging, "apps/server/dist/index.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  banner: {
    js: "import { createRequire as __mhCreateRequire } from 'module'; const require = __mhCreateRequire(import.meta.url);",
  },
  external: [
    "fsevents",
    "@napi-rs/canvas",
    "@napi-rs/canvas-linux-arm64-gnu",
    "@napi-rs/canvas-linux-arm64-musl",
    "@napi-rs/canvas-linux-x64-gnu",
    "@napi-rs/canvas-linux-x64-musl",
  ],
  sourcemap: false,
});

writeFileSync(
  join(staging, "package.json"),
  JSON.stringify(
    {
      name: "memoryhold",
      productName: "Memoryhold",
      version: "0.1.0",
      type: "module",
      main: "dist/main.js",
    },
    null,
    2,
  ),
);

await packager({
  dir: staging,
  out: release,
  overwrite: true,
  name: "Memoryhold",
  platform: "linux",
  arch,
  icon: join(process.cwd(), "assets/icon.png"),
  extraResource: [join(process.cwd(), "assets/icon.png")],
  asar: { unpack: "**/*.node" },
  prune: false,
});

console.log(`Packaged app written to ${release}`);

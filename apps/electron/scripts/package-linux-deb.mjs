import { cpSync, mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(process.cwd(), '../..');
const release = join(root, 'release');
const packageJson = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(join(process.cwd(), 'package.json'), 'utf8')));
const version = packageJson.version;
const electronArch = process.arch === 'arm64' ? 'arm64' : 'x64';
const debArch = process.arch === 'arm64' ? 'arm64' : 'amd64';
const appDir = join(release, `Memoryhold-linux-${electronArch}`);
const debRoot = join(process.cwd(), 'tmp', 'deb-root');
const packageDir = join(debRoot, 'opt/memoryhold');
const debPath = join(release, `memoryhold_${version}_${debArch}.deb`);

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runOutput(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.trim();
}

run('pnpm', ['--filter', '@memoryhold/electron', 'package:linux']);

rmSync(debRoot, { recursive: true, force: true });
mkdirSync(packageDir, { recursive: true });
mkdirSync(join(debRoot, 'DEBIAN'), { recursive: true });
mkdirSync(join(debRoot, 'usr/bin'), { recursive: true });
mkdirSync(join(debRoot, 'usr/share/applications'), { recursive: true });
mkdirSync(join(debRoot, 'usr/share/pixmaps'), { recursive: true });

cpSync(appDir, packageDir, { recursive: true });
chmodSync(join(packageDir, 'chrome-sandbox'), 0o4755);
cpSync(join(process.cwd(), 'assets/icon.png'), join(debRoot, 'usr/share/pixmaps/memoryhold.png'));

writeFileSync(join(debRoot, 'usr/bin/memoryhold'), `#!/bin/sh\nexec /opt/memoryhold/Memoryhold "$@"\n`);
chmodSync(join(debRoot, 'usr/bin/memoryhold'), 0o755);

writeFileSync(join(debRoot, 'usr/share/applications/memoryhold.desktop'), `[Desktop Entry]
Name=Memoryhold
Comment=Memoryhold desktop app
Exec=/opt/memoryhold/Memoryhold %U
Icon=memoryhold
Terminal=false
Type=Application
Categories=Utility;Productivity;
StartupWMClass=Memoryhold
`);

const installedSize = runOutput('du', ['-sk', debRoot]).split(/\s+/)[0];
writeFileSync(join(debRoot, 'DEBIAN/control'), `Package: memoryhold
Version: ${version}
Section: utils
Priority: optional
Architecture: ${debArch}
Maintainer: Memoryhold <noreply@memoryhold.local>
Installed-Size: ${installedSize}
Depends: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1, libsecret-1-0, libgbm1, libasound2 | libasound2t64
Description: Memoryhold desktop app
 Local desktop app for Memoryhold.
`);

run('dpkg-deb', ['--build', '--root-owner-group', debRoot, debPath], process.cwd());
console.log(`Debian package written to ${debPath}`);

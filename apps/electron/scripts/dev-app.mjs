import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import electronPath from 'electron';

if (process.platform !== 'darwin') {
  const result = spawnSync(electronPath, ['.'], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

const sourceApp = join(dirname(dirname(electronPath)), 'Electron.app');
const devApp = join(process.cwd(), 'tmp', 'Memoryhold.app');
const plist = join(devApp, 'Contents', 'Info.plist');

rmSync(devApp, { recursive: true, force: true });
mkdirSync(dirname(devApp), { recursive: true });
cpSync(sourceApp, devApp, { recursive: true });

const setPlist = (key, value) => {
  spawnSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist], { stdio: 'ignore' });
  spawnSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist], { stdio: 'ignore' });
};

setPlist('CFBundleName', 'Memoryhold');
setPlist('CFBundleDisplayName', 'Memoryhold');
setPlist('CFBundleIdentifier', 'com.memoryhold.app');
setPlist('CFBundleSpokenName', 'Memoryhold');

const executable = join(devApp, 'Contents', 'MacOS', 'Electron');
const result = spawnSync(executable, ['.'], { stdio: 'inherit', cwd: process.cwd(), env: process.env });
process.exit(result.status ?? 0);

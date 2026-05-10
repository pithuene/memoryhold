import { spawnSync } from 'node:child_process';
import electronPath from 'electron';

const result = spawnSync(electronPath, ['.'], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: { ...process.env, MEMORYHOLD_ELECTRON_DEV: '1', MEMORYHOLD_PROJECT_ROOT: `${process.cwd()}/../..` },
});
if (result.error) console.error(result.error);
process.exit(result.status ?? 0);

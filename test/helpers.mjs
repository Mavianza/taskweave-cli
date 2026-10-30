import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../lib/config.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const CLI = fileURLToPath(new URL('../bin/taskweave.mjs', import.meta.url));
export const WORKER = fileURLToPath(new URL('./fixtures/worker.mjs', import.meta.url));

export async function workspace(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'taskweave-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export const command = (...args) => ['@node', WORKER, ...args];
export const task = (...args) => ({ command: command(...args) });
export function config(tasks, dir) { return parseConfig({ version: 1, tasks }, path.join(dir, 'tasks.json')); }
export async function saveConfig(dir, tasks) {
  const filename = path.join(dir, 'tasks.json');
  await writeFile(filename, JSON.stringify({ version: 1, tasks }));
  return filename;
}

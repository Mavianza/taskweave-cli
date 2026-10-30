import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';

export class TaskWeaveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TaskWeaveError';
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (message) => { throw new TaskWeaveError(message); };
const validId = (id) => /^[a-z][a-z0-9_-]{0,47}$/.test(id);
const validString = (value) => typeof value === 'string' && !value.includes('\0');

function checkKeys(object, allowed, label) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) fail(`${label}: kolom tidak dikenal: ${key}.`);
  }
}

export function parseConfig(raw, configFile) {
  if (!isObject(raw)) fail('Konfigurasi harus berupa objek JSON.');
  checkKeys(raw, ['version', 'tasks'], 'Konfigurasi');
  if (raw.version !== 1) fail('Versi konfigurasi harus 1.');
  if (!isObject(raw.tasks)) fail('tasks harus berupa objek berisi definisi tugas.');
  const entries = Object.entries(raw.tasks);
  if (!entries.length || entries.length > 100) fail('Konfigurasi harus berisi 1–100 tugas.');
  const absoluteFile = path.resolve(configFile);
  const baseDir = path.dirname(absoluteFile);
  const tasks = entries.map(([id, task]) => {
    if (!validId(id)) fail(`Nama tugas tidak valid: ${id}. Gunakan huruf kecil, angka, _ atau -; awali huruf.`);
    if (!isObject(task)) fail(`Tugas ${id} harus berupa objek.`);
    checkKeys(task, ['command', 'dependsOn', 'timeoutMs', 'cwd'], `Tugas ${id}`);
    if (!Array.isArray(task.command) || !task.command.length || task.command.length > 256 ||
        !task.command.every((arg) => validString(arg) && arg.length <= 8192) || !task.command[0].trim()) {
      fail(`Tugas ${id}: command harus berupa array 1–256 string; argumen maksimal 8192 karakter tanpa NUL.`);
    }
    const dependsOn = task.dependsOn === undefined ? [] : task.dependsOn;
    if (!Array.isArray(dependsOn) || !dependsOn.every((dep) => typeof dep === 'string' && validId(dep)) || new Set(dependsOn).size !== dependsOn.length) {
      fail(`Tugas ${id}: dependsOn harus berupa array nama tugas yang unik.`);
    }
    const timeoutMs = task.timeoutMs === undefined ? 30_000 : task.timeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) {
      fail(`Tugas ${id}: timeoutMs harus integer 1–3600000.`);
    }
    const cwd = task.cwd === undefined ? '.' : task.cwd;
    if (!validString(cwd) || !cwd.trim()) fail(`Tugas ${id}: cwd harus berupa path yang tidak kosong.`);
    return { id, command: [...task.command], dependsOn: [...dependsOn], timeoutMs, cwd: path.resolve(baseDir, cwd) };
  });
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!byId.has(dependency)) fail(`Tugas ${task.id}: dependensi ${dependency} tidak ditemukan.`);
    }
  }
  const config = { version: 1, configFile: absoluteFile, baseDir, tasks };
  planTasks(config); // Seluruh graph diperiksa, termasuk cabang yang tidak dipilih.
  return config;
}

export function planTasks(config, targets = []) {
  if (!Array.isArray(targets) || !targets.every((id) => typeof id === 'string')) fail('Target harus berupa array nama tugas.');
  const byId = new Map(config.tasks.map((task) => [task.id, task]));
  const selected = targets.length ? [...new Set(targets)] : [...byId.keys()];
  const state = new Map();
  const stack = [];
  const order = [];
  function visit(id) {
    if (!byId.has(id)) fail(`Target tidak ditemukan: ${id}.`);
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const cycle = [...stack.slice(stack.indexOf(id)), id].join(' -> ');
      fail(`Dependensi melingkar: ${cycle}.`);
    }
    state.set(id, 1);
    stack.push(id);
    const task = byId.get(id);
    for (const dep of task.dependsOn) visit(dep);
    stack.pop();
    state.set(id, 2);
    order.push(task);
  }
  for (const id of selected) visit(id);
  return order;
}

export async function loadConfig(filename) {
  let handle;
  let raw;
  let configFile;
  try {
    configFile = await realpath(path.resolve(filename));
    handle = await open(configFile, 'r');
    if (!(await handle.stat()).isFile()) fail('Path konfigurasi harus berupa berkas biasa.');
    const limit = 262_144;
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > limit) fail('Konfigurasi melebihi batas 256 KiB.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
    raw = JSON.parse(text);
  } catch (error) {
    if (error instanceof TaskWeaveError) throw error;
    throw new TaskWeaveError(`Konfigurasi tidak dapat dibaca: ${error.message}`);
  } finally {
    await handle?.close();
  }
  const config = parseConfig(raw, configFile);
  for (const task of config.tasks) {
    try {
      if (!(await stat(task.cwd)).isDirectory()) fail(`Tugas ${task.id}: cwd bukan direktori.`);
    } catch (error) {
      if (error instanceof TaskWeaveError) throw error;
      fail(`Tugas ${task.id}: cwd tidak dapat diakses: ${task.cwd}.`);
    }
  }
  return config;
}

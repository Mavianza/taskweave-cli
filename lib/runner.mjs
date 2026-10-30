import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { TaskWeaveError, planTasks } from './config.mjs';

const OUTPUT_LIMIT = 65_536; // Batas untuk masing-masing stdout dan stderr.

function capture(stream) {
  let bytes = 0;
  let truncated = false;
  const chunks = [];
  stream.on('data', (chunk) => {
    const available = OUTPUT_LIMIT - bytes;
    if (chunk.length > available) truncated = true;
    if (available > 0) {
      const part = chunk.subarray(0, available);
      chunks.push(part);
      bytes += part.length;
    }
  });
  return () => ({ text: Buffer.concat(chunks).toString('utf8'), truncated });
}

function killGroup(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    // taskkill menghentikan proses dan turunannya pada Windows.
    const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 3000, stdio: 'ignore' });
    if (result.status !== 0) child.kill('SIGKILL');
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') child.kill('SIGKILL');
    }
  }
}

async function executeTask(task, signal) {
  const start = performance.now();
  const startedAt = new Date().toISOString();
  const executable = task.command[0] === '@node' ? process.execPath : task.command[0];
  const child = spawn(executable, task.command.slice(1), {
    cwd: task.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  const stdout = capture(child.stdout);
  const stderr = capture(child.stderr);
  let stopped = null;
  let spawnError = null;
  let pipeCloseTimer;
  const stop = (reason) => {
    if (stopped) return;
    stopped = reason;
    killGroup(child);
    // Turunan yang melepaskan group atau parent yang sudah keluar dapat
    // menahan pipe. Tutup sisi pembaca agar batas waktu tetap berlaku.
    pipeCloseTimer = setTimeout(() => {
      child.stdout.destroy();
      child.stderr.destroy();
    }, 200);
  };
  const onAbort = () => stop('cancelled');
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timeout = setTimeout(() => stop('timeout'), task.timeoutMs);
  child.on('error', (error) => { spawnError = error.message; });
  return new Promise((resolve) => {
    child.on('close', (code, exitSignal) => {
      clearTimeout(timeout);
      clearTimeout(pipeCloseTimer);
      signal?.removeEventListener('abort', onAbort);
      // Tugas tidak boleh meninggalkan proses background dalam group miliknya.
      if (process.platform !== 'win32') killGroup(child);
      const out = stdout();
      const err = stderr();
      resolve({
        id: task.id,
        status: stopped ?? (code === 0 && !spawnError ? 'success' : 'failed'),
        exitCode: code,
        signal: exitSignal,
        reason: spawnError,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - start),
        stdout: out.text,
        stderr: err.text,
        stdoutTruncated: out.truncated,
        stderrTruncated: err.truncated,
      });
    });
  });
}

function skipTask(task, reason) {
  return { id: task.id, status: 'skipped', exitCode: null, signal: null, reason, startedAt: null, finishedAt: new Date().toISOString(), durationMs: 0, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false };
}

export async function runTasks(config, { targets = [], jobs = 2, signal } = {}) {
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 32) throw new TaskWeaveError('jobs harus integer 1–32.');
  const plan = planTasks(config, targets);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const pending = new Set(plan.map((task) => task.id));
  const results = new Map();
  const running = new Map();
  while (pending.size || running.size) {
    for (const task of plan) {
      if (!pending.has(task.id)) continue;
      if (signal?.aborted) {
        pending.delete(task.id);
        results.set(task.id, skipTask(task, 'Eksekusi dibatalkan sebelum tugas dimulai.'));
        continue;
      }
      const failed = task.dependsOn.filter((dep) => results.has(dep) && results.get(dep).status !== 'success');
      if (failed.length) {
        pending.delete(task.id);
        results.set(task.id, skipTask(task, `Dependensi tidak berhasil: ${failed.join(', ')}.`));
      } else if (running.size < jobs && task.dependsOn.every((dep) => results.get(dep)?.status === 'success')) {
        pending.delete(task.id);
        const promise = executeTask(task, signal).then((result) => {
          results.set(task.id, result);
          running.delete(task.id);
        });
        running.set(task.id, promise);
      }
    }
    if (running.size) await Promise.race(running.values());
    else if (pending.size) throw new TaskWeaveError('Tidak ada tugas yang dapat dijalankan; graph tidak konsisten.');
  }
  const tasks = plan.map((task) => ({ ...results.get(task.id), command: [...task.command], cwd: task.cwd, dependsOn: [...task.dependsOn] }));
  const counts = { success: 0, failed: 0, timeout: 0, cancelled: 0, skipped: 0 };
  for (const task of tasks) counts[task.status]++;
  return {
    schemaVersion: 1,
    configFile: config.configFile,
    status: signal?.aborted ? 'cancelled' : tasks.every((task) => task.status === 'success') ? 'success' : 'failed',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    jobs,
    counts,
    tasks,
  };
}

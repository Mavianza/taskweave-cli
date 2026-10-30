import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CLI, task, workspace, saveConfig } from './helpers.mjs';

function cli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (data) => { stdout += data; });
    child.stderr.setEncoding('utf8').on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test('help dan versi tersedia', async (t) => {
  const dir = await workspace(t);
  for (const flag of ['--help', '--version']) {
    const result = await cli([flag], dir);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /TaskWeave 1.0.0/);
  }
});

test('plan JSON tidak menjalankan command', async (t) => {
  const dir = await workspace(t);
  const filename = await saveConfig(dir, { a: task('touch', 'never') });
  const result = await cli(['plan', filename, '--json'], dir);
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout).order, ['a']);
  await assert.rejects(stat(path.join(dir, 'never')), { code: 'ENOENT' });
});

test('run menghasilkan report file baru yang cocok dengan JSON stdout', async (t) => {
  const dir = await workspace(t);
  const filename = await saveConfig(dir, { a: task('echo', 'halo') });
  const result = await cli(['run', filename, '--json', '--report', 'report.json', '-j', '1'], dir);
  assert.equal(result.code, 0, result.stderr);
  const stdout = JSON.parse(result.stdout);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'report.json'), 'utf8')), stdout);
  assert.equal(stdout.counts.success, 1);
});

test('exit code kegagalan task adalah 1 dan child exit code dipertahankan', async (t) => {
  const dir = await workspace(t);
  const filename = await saveConfig(dir, { bad: task('fail') });
  const result = await cli(['run', filename, '--json'], dir);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stdout).tasks[0].exitCode, 7);
});

test('konfigurasi salah dan target salah menghasilkan exit 2', async (t) => {
  const dir = await workspace(t);
  const filename = await saveConfig(dir, { a: task('echo') });
  const missing = await cli(['run', filename, 'missing', '--json'], dir);
  assert.equal(missing.code, 2);
  assert.equal(JSON.parse(missing.stdout).status, 'error');
  await writeFile(filename, '{invalid}');
  const bad = await cli(['run', filename, '--json'], dir);
  assert.equal(bad.code, 2);
  assert.match(JSON.parse(bad.stdout).error, /tidak dapat dibaca/);
});

test('siklus ditolak sebelum satu pun perintah dijalankan', async (t) => {
  const dir = await workspace(t);
  const filename = await saveConfig(dir, { safe: task('touch', 'never'), a: { ...task('echo'), dependsOn: ['b'] }, b: { ...task('echo'), dependsOn: ['a'] } });
  const result = await cli(['run', filename, 'safe'], dir);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /melingkar/);
  await assert.rejects(stat(path.join(dir, 'never')), { code: 'ENOENT' });
});

test('report yang sudah ada ditolak sebelum task berjalan', async (t) => {
  const dir = await workspace(t);
  const filename = await saveConfig(dir, { a: task('touch', 'never') });
  const report = path.join(dir, 'report.json');
  await writeFile(report, 'data lama');
  const result = await cli(['run', filename, '--report', report], dir);
  assert.equal(result.code, 2);
  assert.equal(await readFile(report, 'utf8'), 'data lama');
  await assert.rejects(stat(path.join(dir, 'never')), { code: 'ENOENT' });
});

test('opsi jobs invalid, opsi tidak dikenal, dan penggunaan salah ditolak', async (t) => {
  const dir = await workspace(t);
  const filename = await saveConfig(dir, { a: task('echo') });
  for (const args of [['run', filename, '--jobs', '0'], ['run', filename, '--jobs', '1.5'], ['run', filename, '--jobs', '33'], ['run', filename, '--unknown'], ['plan', filename, '--jobs', '2'], ['run']]) {
    const result = await cli(args, dir);
    assert.equal(result.code, 2, JSON.stringify(args));
  }
});

test('SIGTERM membatalkan proses aktif dan menghasilkan laporan', { skip: process.platform === 'win32' }, async (t) => {
  const dir = await workspace(t);
  const marker = path.join(dir, 'started');
  const filename = await saveConfig(dir, { slow: task('sleep', '10000', marker) });
  const child = spawn(process.execPath, [CLI, 'run', filename, '--json'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', (data) => { stdout += data; });
  const closed = new Promise((resolve) => child.on('close', (code) => resolve(code)));
  let started = false;
  for (let i = 0; i < 200; i++) {
    try { await stat(marker); started = true; break; } catch { await delay(10); }
  }
  child.kill('SIGTERM');
  const code = await closed;
  assert.equal(started, true);
  assert.equal(code, 143);
  assert.equal(JSON.parse(stdout).status, 'cancelled');
});

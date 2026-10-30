import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runTasks } from '../lib/runner.mjs';
import { task, config, workspace, command } from './helpers.mjs';

test('dependensi selesai sebelum tugas berikutnya dan cwd diterapkan', async (t) => {
  const dir = await workspace(t);
  const c = config({ first: task('touch', 'first.txt', 'siap'), second: { ...task('require', 'first.txt', 'second.txt'), dependsOn: ['first'] } }, dir);
  const report = await runTasks(c);
  assert.equal(report.status, 'success');
  assert.equal(await readFile(path.join(dir, 'second.txt'), 'utf8'), 'siap -> lanjutan');
  assert.equal(report.counts.success, 2);
});

test('dua tugas dapat saling melihat saat berjalan paralel', async (t) => {
  const dir = await workspace(t);
  const c = config({ a: task('barrier', dir, 'a', 'b'), b: task('barrier', dir, 'b', 'a') }, dir);
  const report = await runTasks(c, { jobs: 2 });
  assert.equal(report.status, 'success', JSON.stringify(report));
  assert.equal(report.counts.success, 2);
});

test('batas jobs membatasi jumlah proses aktif', async (t) => {
  const dir = await workspace(t);
  for (const jobs of [1, 2]) {
    const file = path.join(dir, `events-${jobs}.jsonl`);
    const c = config(Object.fromEntries(['a', 'b', 'c', 'd'].map((id) => [id, task('events', file, id, '50')])), dir);
    const report = await runTasks(c, { jobs });
    assert.equal(report.status, 'success');
    const events = (await readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
    let active = 0;
    for (const event of events) {
      active += event.event === 'start' ? 1 : -1;
      assert.ok(active >= 0 && active <= jobs, `${active} proses melebihi batas ${jobs}`);
    }
    assert.equal(active, 0);
    assert.equal(events.length, 8);
  }
});

test('gagal men-skips rantai dependensi; tugas independen tetap berjalan', async (t) => {
  const dir = await workspace(t);
  const c = config({ bad: task('fail'), blocked: { ...task('touch', 'blocked'), dependsOn: ['bad'] }, downstream: { ...task('touch', 'downstream'), dependsOn: ['blocked'] }, other: task('touch', 'other') }, dir);
  const report = await runTasks(c);
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.tasks.map((r) => r.status), ['failed', 'skipped', 'skipped', 'success']);
  assert.equal(report.tasks[0].exitCode, 7);
  assert.match(report.tasks[0].stderr, /kegagalan disengaja/);
  await assert.rejects(stat(path.join(dir, 'blocked')), { code: 'ENOENT' });
  assert.equal((await stat(path.join(dir, 'other'))).isFile(), true);
});

test('timeout menghentikan tugas dan melewati dependensinya', async (t) => {
  const dir = await workspace(t);
  const c = config({ slow: { ...task('sleep', '10000'), timeoutMs: 150 }, next: { ...task('touch', 'next'), dependsOn: ['slow'] } }, dir);
  const report = await runTasks(c);
  assert.equal(report.tasks[0].status, 'timeout');
  assert.equal(report.tasks[1].status, 'skipped');
  assert.equal(report.status, 'failed');
});

test('command tidak ditemukan menjadi failed, bukan crash', async (t) => {
  const dir = await workspace(t);
  const c = config({ missing: { command: ['taskweave-command-that-does-not-exist-5180'] } }, dir);
  const report = await runTasks(c);
  assert.equal(report.status, 'failed');
  assert.equal(report.tasks[0].status, 'failed');
  assert.match(report.tasks[0].reason, /ENOENT/);
});

test('argumen simbol shell diteruskan sebagai literal', async (t) => {
  const dir = await workspace(t);
  const args = ['a b', '; echo injected', '$(echo injected)', '*', 'kutip"'];
  const report = await runTasks(config({ a: task('echo', ...args) }, dir));
  assert.equal(report.status, 'success');
  assert.deepEqual(JSON.parse(report.tasks[0].stdout), args);
});

test('capture stdout dan stderr dibatasi 64 KiB per stream', async (t) => {
  const dir = await workspace(t);
  const report = await runTasks(config({ a: task('output') }, dir));
  const result = report.tasks[0];
  assert.equal(result.status, 'success');
  assert.equal(Buffer.byteLength(result.stdout), 65536);
  assert.equal(Buffer.byteLength(result.stderr), 65536);
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stderrTruncated, true);
});

test('target tidak menjalankan tugas yang tidak terkait', async (t) => {
  const dir = await workspace(t);
  const c = config({ a: task('touch', 'a'), b: { ...task('touch', 'b'), dependsOn: ['a'] }, other: task('touch', 'other') }, dir);
  const report = await runTasks(c, { targets: ['b'] });
  assert.deepEqual(report.tasks.map((r) => r.id), ['a', 'b']);
  await assert.rejects(stat(path.join(dir, 'other')), { code: 'ENOENT' });
});

test('dependensi bersama hanya dijalankan satu kali', async (t) => {
  const dir = await workspace(t);
  const log = path.join(dir, 'shared.jsonl');
  const c = config({ shared: task('events', log, 'shared', '10'), a: { ...task('echo'), dependsOn: ['shared'] }, b: { ...task('echo'), dependsOn: ['shared'] } }, dir);
  const report = await runTasks(c, { targets: ['a', 'b'] });
  assert.equal(report.tasks.length, 3);
  assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 2);
});

test('sinyal yang sudah abort tidak memulai proses', async (t) => {
  const dir = await workspace(t);
  const controller = new AbortController();
  controller.abort();
  const report = await runTasks(config({ a: task('touch', 'never') }, dir), { signal: controller.signal });
  assert.equal(report.status, 'cancelled');
  assert.equal(report.tasks[0].status, 'skipped');
  await assert.rejects(stat(path.join(dir, 'never')), { code: 'ENOENT' });
});

test('abort menghentikan tugas aktif dan tidak memulai tugas pending', async (t) => {
  const dir = await workspace(t);
  const marker = path.join(dir, 'started');
  const controller = new AbortController();
  const promise = runTasks(config({ slow: task('sleep', '10000', marker), pending: task('touch', 'pending') }, dir), { jobs: 1, signal: controller.signal });
  for (let i = 0; i < 100; i++) {
    try { await stat(marker); break; } catch { await delay(10); }
  }
  controller.abort();
  const report = await promise;
  assert.equal(report.status, 'cancelled');
  assert.equal(report.tasks[0].status, 'cancelled');
  assert.equal(report.tasks[1].status, 'skipped');
});

test('jobs invalid ditolak', async (t) => {
  const dir = await workspace(t);
  const c = config({ a: task('echo') }, dir);
  for (const jobs of [0, 33, 1.5, '2']) await assert.rejects(runTasks(c, { jobs }), /jobs/);
});

test('timeout menghentikan child dalam process group POSIX', { skip: process.platform === 'win32' }, async (t) => {
  const dir = await workspace(t);
  const marker = path.join(dir, 'descendant.pid');
  const c = config({ a: { command: command('fork', marker), timeoutMs: 1000 } }, dir);
  const report = await runTasks(c);
  assert.equal(report.tasks[0].status, 'timeout');
  const pid = Number(await readFile(marker, 'utf8'));
  let running = true;
  // Pengiriman signal dan penjadwalan OS bersifat asinkron.
  for (let attempt = 0; attempt < 50 && running; attempt++) {
    try {
      process.kill(pid, 0);
      // Pada container, proses mati dapat menunggu reaping PID 1 sebagai zombie.
      const proc = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
      running = !/\) Z /.test(proc);
    } catch (error) {
      assert.equal(error.code, 'ESRCH');
      running = false;
    }
    if (running) await delay(10);
  }
  if (running) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  assert.equal(running, false, 'Proses turunan masih hidup setelah timeout');
});

test('pipe turunan di luar group tidak menggantungkan runner melewati timeout', { skip: process.platform === 'win32' }, async (t) => {
  const dir = await workspace(t);
  const marker = path.join(dir, 'escaped.pid');
  const c = config({ a: { command: command('escape', marker), timeoutMs: 1000 } }, dir);
  const started = Date.now();
  try {
    const report = await runTasks(c);
    assert.equal(report.tasks[0].status, 'timeout');
    assert.ok(Date.now() - started < 4000, 'Runner menunggu pipe di luar process group');
    await stat(marker);
  } finally {
    // Fixture ini sengaja melepaskan process group; bersihkan PID miliknya.
    const pid = Number(await readFile(marker, 'utf8').catch(() => '0'));
    if (pid > 0) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  }
});

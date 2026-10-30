import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, parseConfig, planTasks, TaskWeaveError } from '../lib/config.mjs';
import { task, config, workspace, saveConfig } from './helpers.mjs';

test('urutan topologis dengan dependensi bersama tidak menggandakan tugas', async (t) => {
  const dir = await workspace(t);
  const c = config({ a: task('echo', 'a'), b: { ...task('echo', 'b'), dependsOn: ['a'] }, c: { ...task('echo', 'c'), dependsOn: ['a'] }, d: { ...task('echo', 'd'), dependsOn: ['b', 'c'] } }, dir);
  assert.deepEqual(planTasks(c).map((item) => item.id), ['a', 'b', 'c', 'd']);
});

test('pemilihan target hanya menyertakan closure dependensinya', async (t) => {
  const dir = await workspace(t);
  const c = config({ a: task('echo'), b: { ...task('echo'), dependsOn: ['a'] }, other: task('echo') }, dir);
  assert.deepEqual(planTasks(c, ['b', 'b']).map((item) => item.id), ['a', 'b']);
  assert.throws(() => planTasks(c, ['missing']), /Target tidak ditemukan/);
});

test('siklus langsung ditolak', async (t) => {
  const dir = await workspace(t);
  assert.throws(() => config({ a: { ...task('echo'), dependsOn: ['a'] } }, dir), /a -> a/);
});

test('siklus lintas tugas ditolak dan jalurnya ditampilkan', async (t) => {
  const dir = await workspace(t);
  assert.throws(() => config({ a: { ...task('echo'), dependsOn: ['b'] }, b: { ...task('echo'), dependsOn: ['c'] }, c: { ...task('echo'), dependsOn: ['a'] } }, dir), /a -> b -> c -> a/);
});

test('dependensi tidak ada dan dependensi ganda ditolak', async (t) => {
  const dir = await workspace(t);
  assert.throws(() => config({ a: { ...task('echo'), dependsOn: ['missing'] } }, dir), /tidak ditemukan/);
  assert.throws(() => config({ a: task('echo'), b: { ...task('echo'), dependsOn: ['a', 'a'] } }, dir), /unik/);
});

test('versi, tipe, dan kolom konfigurasi diperiksa', () => {
  for (const raw of [null, [], { version: 2, tasks: {} }, { version: 1, tasks: {} }, { version: 1, tasks: [] }, { version: 1, tasks: {}, extra: true }]) {
    assert.throws(() => parseConfig(raw, 'tasks.json'), TaskWeaveError);
  }
});

test('command wajib array argumen, bukan shell string', async (t) => {
  const dir = await workspace(t);
  for (const command of ['echo hi', [], [''], ['node', null], ['node\0'], Array(257).fill('x'), ['node', 'x'.repeat(8193)]]) {
    assert.throws(() => config({ a: { command } }, dir), /command/);
  }
});

test('nama tugas dan batas jumlah diperiksa', async (t) => {
  const dir = await workspace(t);
  for (const id of ['Bad', '_a', 'a b', 'a'.repeat(49)]) assert.throws(() => config({ [id]: task('echo') }, dir), /Nama tugas/);
  const tasks = Object.fromEntries(Array.from({ length: 101 }, (_, n) => [`a${n}`, task('echo')]));
  assert.throws(() => config(tasks, dir), /1–100/);
});

test('timeout, cwd, dependensi null dan typo diperiksa', async (t) => {
  const dir = await workspace(t);
  for (const override of [{ timeoutMs: 0 }, { timeoutMs: 1.5 }, { timeoutMs: null }, { timeoutMs: 3600001 }, { cwd: '' }, { cwd: null }, { dependsOn: null }, { dependOn: [] }]) {
    assert.throws(() => config({ a: { ...task('echo'), ...override } }, dir), TaskWeaveError);
  }
});

test('loadConfig menerima BOM dan cwd relatif lokasi konfigurasi', async (t) => {
  const dir = await workspace(t);
  await mkdir(path.join(dir, 'work'));
  const filename = path.join(dir, 'tasks.json');
  await writeFile(filename, '\ufeff' + JSON.stringify({ version: 1, tasks: { a: { ...task('echo'), cwd: 'work' } } }));
  const c = await loadConfig(filename);
  assert.equal(c.tasks[0].cwd, path.join(dir, 'work'));
});

test('loadConfig menolak berkas rusak, terlalu besar, UTF-8 salah, dan hilang', async (t) => {
  const dir = await workspace(t);
  for (const data of ['{bad}', Buffer.alloc(262145, 32), Buffer.from([0xff, 0xfe])]) {
    const filename = path.join(dir, 'bad.json');
    await writeFile(filename, data);
    await assert.rejects(loadConfig(filename), TaskWeaveError);
  }
  await assert.rejects(loadConfig(path.join(dir, 'missing.json')), /tidak dapat dibaca/);
});

test('cwd tidak ada atau berupa file ditolak sebelum eksekusi', async (t) => {
  const dir = await workspace(t);
  await writeFile(path.join(dir, 'file.txt'), 'x');
  for (const cwd of ['missing', 'file.txt']) {
    const filename = await saveConfig(dir, { a: { ...task('echo'), cwd } });
    await assert.rejects(loadConfig(filename), /cwd/);
  }
});

test('nama constructor tidak bentrok dengan prototype object', async (t) => {
  const dir = await workspace(t);
  const c = config({ constructor: task('echo'), done: { ...task('echo'), dependsOn: ['constructor'] } }, dir);
  assert.deepEqual(planTasks(c).map((item) => item.id), ['constructor', 'done']);
});

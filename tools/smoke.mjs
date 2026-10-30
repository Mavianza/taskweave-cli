import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin/taskweave.mjs');
const dir = await mkdtemp(path.join(os.tmpdir(), 'taskweave-smoke-'));
let passed = 0;
function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd: dir, encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error);
  return { code: result.status, report: JSON.parse(result.stdout) };
}
try {
  const demo = path.join(dir, 'demo');
  await cp(path.join(root, 'examples'), demo, { recursive: true, filter: (source) => path.basename(source) !== 'output' });
  const filename = path.join(demo, 'taskweave.json');
  const plan = run(['plan', filename, 'verify']);
  assert.equal(plan.code, 0);
  assert.deepEqual(plan.report.order, ['syntax', 'test', 'build', 'verify']);
  await assert.rejects(stat(path.join(demo, 'demo/output/result.json')), { code: 'ENOENT' });
  passed++;

  const reportFile = path.join(dir, 'report.json');
  const pipeline = run(['run', filename, 'verify', '--jobs', '2', '--report', reportFile]);
  assert.equal(pipeline.code, 0);
  assert.equal(pipeline.report.counts.success, 4);
  assert.equal(JSON.parse(await readFile(path.join(demo, 'demo/output/result.json'), 'utf8')).sum, 16);
  assert.deepEqual(JSON.parse(await readFile(reportFile, 'utf8')), pipeline.report);
  passed++;

  const failConfig = path.join(dir, 'fail.json');
  await writeFile(failConfig, JSON.stringify({ version: 1, tasks: {
    fail: { command: ['@node', '-e', 'process.exit(7)'] },
    blocked: { command: ['@node', '-e', 'process.exit(0)'], dependsOn: ['fail'] },
    independent: { command: ['@node', '-e', 'console.log("tetap berjalan")'] },
  } }));
  const failure = run(['run', failConfig]);
  assert.equal(failure.code, 1);
  assert.deepEqual(failure.report.tasks.map((task) => task.status), ['failed', 'skipped', 'success']);
  passed++;

  const slowConfig = path.join(dir, 'slow.json');
  await writeFile(slowConfig, JSON.stringify({ version: 1, tasks: { slow: { command: ['@node', '-e', 'setTimeout(()=>{},10000)'], timeoutMs: 150 } } }));
  const timeout = run(['run', slowConfig]);
  assert.equal(timeout.code, 1);
  assert.equal(timeout.report.tasks[0].status, 'timeout');
  passed++;

  const cycle = path.join(dir, 'cycle.json');
  await writeFile(cycle, JSON.stringify({ version: 1, tasks: {
    a: { command: ['@node', '-e', 'process.exit(0)'], dependsOn: ['b'] },
    b: { command: ['@node', '-e', 'process.exit(0)'], dependsOn: ['a'] },
  } }));
  const invalid = run(['run', cycle]);
  assert.equal(invalid.code, 2);
  assert.match(invalid.report.error, /melingkar/);
  passed++;

  const protectedFile = await readFile(reportFile, 'utf8');
  const replay = run(['run', filename, '--report', reportFile]);
  assert.equal(replay.code, 2);
  assert.equal(await readFile(reportFile, 'utf8'), protectedFile);
  passed++;
  console.log(`${passed}/6 skenario CLI lulus: plan, pipeline build+report, gagal+skip, timeout, siklus, laporan terlindungi.`);
} finally {
  await rm(dir, { recursive: true, force: true });
}

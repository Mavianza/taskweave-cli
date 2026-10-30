import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const [mode, ...args] = process.argv.slice(2);
if (mode === 'echo') {
  console.log(JSON.stringify(args));
} else if (mode === 'fail') {
  console.log('keluaran sebelum gagal');
  console.error('kegagalan disengaja');
  process.exitCode = 7;
} else if (mode === 'touch') {
  writeFileSync(args[0], args[1] ?? 'siap');
} else if (mode === 'require') {
  const content = readFileSync(args[0], 'utf8');
  writeFileSync(args[1], content + ' -> lanjutan');
} else if (mode === 'sleep') {
  if (args[1]) writeFileSync(args[1], String(process.pid));
  console.log('mulai');
  await delay(Number(args[0]));
  console.log('selesai');
} else if (mode === 'events') {
  const [file, id, milliseconds] = args;
  appendFileSync(file, JSON.stringify({ id, event: 'start', time: Date.now() }) + '\n');
  await delay(Number(milliseconds));
  appendFileSync(file, JSON.stringify({ id, event: 'end', time: Date.now() }) + '\n');
} else if (mode === 'barrier') {
  const [dir, id, peer] = args;
  writeFileSync(path.join(dir, id), 'started');
  const deadline = Date.now() + 3000;
  while (!existsSync(path.join(dir, peer))) {
    if (Date.now() > deadline) throw new Error('Peer tidak pernah berjalan paralel.');
    await delay(5);
  }
  console.log(`${id} melihat peer ${peer}`);
} else if (mode === 'output') {
  process.stdout.write('x'.repeat(100000));
  process.stderr.write('y'.repeat(100000));
} else if (mode === 'fork') {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'sleep', '10000', args[0]], { stdio: 'inherit' });
  child.on('error', (error) => { throw error; });
  await delay(10000);
} else if (mode === 'escape') {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'sleep', '10000', args[0]], { detached: true, stdio: 'inherit' });
  child.on('error', (error) => { throw error; });
  child.unref();
} else {
  throw new Error(`Mode fixture tidak dikenal: ${mode}`);
}

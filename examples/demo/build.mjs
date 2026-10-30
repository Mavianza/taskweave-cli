import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { sum } from './project.mjs';

const source = await readFile(new URL('./project.mjs', import.meta.url));
const output = new URL('./output/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('result.json', output), JSON.stringify({ sum: sum([3, 5, 8]), sourceSha256: createHash('sha256').update(source).digest('hex') }, null, 2) + '\n');
console.log('Build selesai: output/result.json');

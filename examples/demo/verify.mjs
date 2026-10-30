import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const result = JSON.parse(await readFile(new URL('./output/result.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('./project.mjs', import.meta.url));
assert.equal(result.sum, 16);
assert.equal(result.sourceSha256, createHash('sha256').update(source).digest('hex'));
console.log('Artefak build valid: sum=16 dan SHA-256 source cocok.');

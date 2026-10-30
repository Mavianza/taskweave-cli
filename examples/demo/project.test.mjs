import test from 'node:test';
import assert from 'node:assert/strict';
import { sum } from './project.mjs';

test('jumlah bilangan', () => assert.equal(sum([3, 5, 8]), 16));
test('array kosong', () => assert.equal(sum([]), 0));
test('masukan salah ditolak', () => assert.throws(() => sum(['3']), TypeError));

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const exports: any = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/version.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const cmp = exports.compareVersions;

test('release versions compare numerically', () => {
  assert.equal(cmp('0.1.2', '0.2.0'), -1);
  assert.equal(cmp('0.10.0', '0.9.9'), 1);
  assert.equal(cmp('1.0.0', '1.0.0'), 0);
});

test('a beta comes before its release and after the previous one', () => {
  assert.equal(cmp('0.2.0-beta.1', '0.2.0'), -1);
  assert.equal(cmp('0.2.0', '0.2.0-beta.1'), 1);
  assert.equal(cmp('0.2.0-beta.1', '0.1.2'), 1);
  assert.equal(cmp('0.2.0-beta.2', '0.2.0-beta.10'), -1);
  assert.equal(cmp('0.2.0-beta.1', '0.2.0-beta.1'), 0);
});

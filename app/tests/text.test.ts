import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const exports: any = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/text.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });

test('previews drop Markdown syntax and keep the words', () => {
  assert.equal(exports.plainText("Here's a helper:\n\n```ts\nconst x = 1;\n```\n\n**Bold** and `code`, [a link](https://x.io)."),
    "Here's a helper: const x = 1; Bold and code, a link.");
  assert.equal(exports.plainText('# Title\n- one\n- two\n> quoted\n1. first'), 'Title one two quoted first');
});

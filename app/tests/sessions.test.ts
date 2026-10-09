import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const exports: any = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/sessions.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { sourceLabel, sessionTitle, markedParts } = exports;

test('sources read as app names', () => {
  assert.equal(sourceLabel('cli'), 'Terminal');
  assert.equal(sourceLabel('cron'), 'Routine');
  assert.equal(sourceLabel('telegram'), 'Telegram');
  assert.equal(sourceLabel('home_assistant'), 'Home Assistant');
  assert.equal(sourceLabel(''), 'Unknown');
});

test('a conversation is named by its title, else how it began', () => {
  assert.equal(sessionTitle({ id: 'x', title: ' Trip ', preview: 'p' }), 'Trip');
  assert.equal(sessionTitle({ id: 'x', title: null, preview: '[IMPORTANT: cron] Morning briefing' }), 'Morning briefing');
  assert.equal(sessionTitle({ id: 'x', title: null, preview: 'a'.repeat(80) }).length, 60);
  assert.equal(sessionTitle({ id: 'abc', title: null, preview: '' }), 'abc');
});

test('search snippets split around the marked matches', () => {
  assert.deepEqual(Array.from(markedParts('Find >>>Lisbon<<< flights to >>>lisbon<<<'), (p: any) => [p.text, p.hit]),
    [['Find ', false], ['Lisbon', true], [' flights to ', false], ['lisbon', true]]);
  assert.deepEqual(Array.from(markedParts('no match'), (p: any) => [p.text, p.hit]), [['no match', false]]);
  assert.deepEqual(Array.from(markedParts('>>><<<x'), (p: any) => [p.text, p.hit]), [['x', false]]);
});

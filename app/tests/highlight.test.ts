import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const exports: any = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/highlight.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { highlight } = exports;

const kinds = (code: string, lang: string) =>
  Object.fromEntries(highlight(code, lang).filter((s: any) => s.kind).map((s: any) => [s.text.trim(), s.kind]));

test('the spans always add back up to the original code', () => {
  const samples: [string, string][] = [
    ['const x = await fetch(`/api/${id}`); // load\nexport default x;', 'ts'],
    ['def go(n=3):\n    """Doc."""\n    return f"{n}" # done', 'python'],
    ['$ sudo apt install -y curl && echo "$HOME" | grep -i home', 'bash'],
    ['{"a": [1, -2.5e3, true, null], "b": "c"}', 'json'],
    ['server:\n  port: 8080 # http\n  name: "winglet"', 'yaml'],
    ['SELECT name FROM users WHERE id = 1; -- one', 'sql'],
    ['<a href="x">hi</a><!-- c -->', 'html'],
    ['@@ -1 +1 @@\n-old\n+new', 'diff'],
    ['no language here', ''],
  ];
  for (const [code, lang] of samples) {
    assert.equal(highlight(code, lang).map((s: any) => s.text).join(''), code, lang);
  }
});

test('typescript: keywords, strings, comments, calls and types', () => {
  const k = kinds('const user: User = await load("me"); // fetch', 'tsx');
  assert.equal(k.const, 'keyword');
  assert.equal(k.await, 'keyword');
  assert.equal(k.User, 'type');
  assert.equal(k.load, 'function');
  assert.equal(k['"me"'], 'string');
  assert.equal(k['// fetch'], 'comment');
});

test('python: triple-quoted strings, f-strings, decorators and numbers', () => {
  const k = kinds('@cache\ndef f():\n    """Hi."""\n    return f"x" + 42', 'py');
  assert.equal(k['@cache'], 'type');
  assert.equal(k.def, 'keyword');
  assert.equal(k['"""Hi."""'], 'string');
  assert.equal(k['f"x"'], 'string');
  assert.equal(k['42'], 'number');
});

test('shell: commands, flags, variables, and a # inside a word is not a comment', () => {
  const k = kinds('$ git log --oneline | head -n 3 # recent\necho "$HOME" url#frag', 'sh');
  assert.equal(k.git, 'function');
  assert.equal(k.head, 'function');
  assert.equal(k['--oneline'], 'type');
  assert.equal(k['# recent'], 'comment');
  assert.equal(k['"$HOME"'], 'string');
  assert.ok(!Object.keys(k).some((key) => key.includes('#frag')));
});

test('json keys and values look different', () => {
  const k = kinds('{"name": "winglet", "ok": true}', 'json');
  assert.equal(k['"name"'], 'function');
  assert.equal(k['"winglet"'], 'string');
  assert.equal(k.true, 'keyword');
});

test('unknown languages are left plain', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(highlight('if (x) return 1', 'brainfork'))), [{ text: 'if (x) return 1' }]);
});

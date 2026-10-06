// A small syntax highlighter for code in chat: comments, strings, numbers, keywords, function names
// and types for the languages an agent usually writes. Not a parser; it only has to look right.

export type SynKind = 'keyword' | 'string' | 'number' | 'comment' | 'function' | 'type';
export type Span = { text: string; kind?: SynKind };

type Family = 'js' | 'py' | 'sh' | 'json' | 'yaml' | 'clike' | 'rust' | 'go' | 'ruby' | 'sql' | 'html' | 'css' | 'diff';

const ALIASES: Record<string, Family> = {
  js: 'js', javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', typescript: 'js', tsx: 'js',
  py: 'py', python: 'py', python3: 'py', ipython: 'py',
  sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', terminal: 'sh', shellscript: 'sh', fish: 'sh', powershell: 'sh', ps1: 'sh',
  json: 'json', jsonc: 'json', json5: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'yaml', ini: 'yaml', conf: 'yaml', env: 'yaml', dotenv: 'yaml', dockerfile: 'sh',
  java: 'clike', kotlin: 'clike', kt: 'clike', c: 'clike', cpp: 'clike', 'c++': 'clike', h: 'clike', hpp: 'clike',
  cs: 'clike', csharp: 'clike', swift: 'clike', scala: 'clike', dart: 'clike', php: 'clike',
  rs: 'rust', rust: 'rust', go: 'go', golang: 'go', rb: 'ruby', ruby: 'ruby', sql: 'sql', psql: 'sql', sqlite: 'sql',
  html: 'html', xml: 'html', svg: 'html', vue: 'html', css: 'css', scss: 'css', less: 'css', diff: 'diff', patch: 'diff',
};

const words = (s: string) => new Set(s.split(' '));
const KEYWORDS: Partial<Record<Family, Set<string>>> = {
  js: words('break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return super switch this throw try typeof var void while with yield async await static get set as interface type enum implements private public protected readonly declare namespace abstract satisfies keyof true false null undefined'),
  py: words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None self match case'),
  sh: words('if then else elif fi for while until do done case esac in function return export local readonly unset source alias exit FROM RUN CMD COPY ADD ENV WORKDIR EXPOSE ENTRYPOINT ARG USER VOLUME LABEL'),
  json: words('true false null'),
  yaml: words('true false null yes no on off'),
  clike: words('abstract auto bool boolean break byte case catch char class const continue default delete do double else enum explicit export extends extern false final finally float for friend fun func goto if implements import in inline instanceof int interface internal is let long namespace new null nullptr object override package private protected public register return short signed sizeof static struct super switch template this throw throws true try typedef typename union unsigned using val var virtual void volatile when where while include define echo function'),
  rust: words('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while'),
  go: words('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota'),
  ruby: words('alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require require_relative attr_accessor attr_reader puts'),
  sql: words('select from where and or not insert into values update set delete create table drop alter index join left right inner outer on group by order having limit offset as distinct union all null is in like between case when then else end primary key foreign references default exists count sum avg min max asc desc returning with view begin commit rollback if'),
};

const SLASH = String.raw`//[^\n]*|/\*[\s\S]*?\*/`;
const HASH = String.raw`#[^\n]*`;
const DQ = String.raw`"(?:\\.|[^"\\\n])*"`;
const SQ = String.raw`'(?:\\.|[^'\\\n])*'`;
const BT = String.raw`\`(?:\\.|[^\`\\])*\``;
const TRIPLE = String.raw`"""[\s\S]*?"""|'''[\s\S]*?'''`;
const NUM = String.raw`\b(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b`;
const WORD = String.raw`[A-Za-z_$][\w$]*`;

/** Per family: an ordered list of [pattern, kind]. "word" tokens are classified afterwards. */
const RULES: Record<Family, [string, SynKind | 'word' | 'key' | 'var' | 'cmd'][]> = {
  js: [[SLASH, 'comment'], [BT, 'string'], [DQ, 'string'], [SQ, 'string'], [String.raw`@[\w.]+`, 'type'], [NUM, 'number'], [WORD, 'word']],
  py: [[HASH, 'comment'], [TRIPLE, 'string'], [String.raw`[rbfuRBFU]{0,2}(?:${DQ}|${SQ})`, 'string'], [String.raw`@[\w.]+`, 'type'], [NUM, 'number'], [WORD, 'word']],
  sh: [[String.raw`(?:^|(?<=\s))#[^\n]*`, 'comment'], [DQ, 'string'], [SQ, 'string'], [String.raw`\$\{[^}\n]*\}|\$[A-Za-z_]\w*|\$[0-9@#?*!$-]`, 'var'],
    [String.raw`(?<![\w-])--?[A-Za-z][\w-]*`, 'type'], [NUM, 'number'], [String.raw`[A-Za-z_./~][\w./~+-]*`, 'cmd']],
  json: [[SLASH, 'comment'], [DQ, 'key'], [String.raw`-?${NUM}`, 'number'], [WORD, 'word']],
  yaml: [[String.raw`(?:^|(?<=\s))[#;][^\n]*`, 'comment'], [DQ, 'string'], [SQ, 'string'], [String.raw`^[ \t-]*[\w.-]+(?=\s*[:=])`, 'function'],
    [String.raw`^\[[^\]\n]+\]`, 'type'], [NUM, 'number'], [WORD, 'word']],
  clike: [[SLASH, 'comment'], [String.raw`#\s*\w+`, 'keyword'], [DQ, 'string'], [String.raw`'(?:\\.|[^'\\\n])'`, 'string'], [String.raw`@\w+`, 'type'],
    [String.raw`\$\w+`, 'var'], [NUM, 'number'], [WORD, 'word']],
  rust: [[SLASH, 'comment'], [DQ, 'string'], [String.raw`'(?:\\.|[^'\\\n])'`, 'string'], [String.raw`#!?\[[^\]\n]*\]`, 'type'],
    [String.raw`\b\w+!`, 'function'], [NUM, 'number'], [WORD, 'word']],
  go: [[SLASH, 'comment'], [BT, 'string'], [DQ, 'string'], [String.raw`'(?:\\.|[^'\\\n])'`, 'string'], [NUM, 'number'], [WORD, 'word']],
  ruby: [[HASH, 'comment'], [DQ, 'string'], [SQ, 'string'], [String.raw`:[A-Za-z_]\w*`, 'type'], [String.raw`@{1,2}\w+`, 'var'], [NUM, 'number'], [String.raw`[A-Za-z_]\w*[?!]?`, 'word']],
  sql: [[String.raw`--[^\n]*|/\*[\s\S]*?\*/`, 'comment'], [SQ, 'string'], [DQ, 'type'], [NUM, 'number'], [WORD, 'word']],
  html: [[String.raw`<!--[\s\S]*?-->`, 'comment'], [String.raw`</?[A-Za-z][\w:.-]*|/?>`, 'keyword'], [String.raw`[\w:-]+(?==)`, 'function'], [DQ, 'string'], [SQ, 'string']],
  css: [[String.raw`/\*[\s\S]*?\*/`, 'comment'], [DQ, 'string'], [SQ, 'string'], [String.raw`@[\w-]+`, 'keyword'], [String.raw`#[\da-fA-F]{3,8}\b`, 'number'],
    [String.raw`[\w-]+(?=\s*:[^:])`, 'function'], [String.raw`-?\d*\.?\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\b`, 'number']],
  diff: [[String.raw`^@@[^\n]*`, 'type'], [String.raw`^\+[^\n]*`, 'string'], [String.raw`^-[^\n]*`, 'keyword'], [String.raw`^(?:diff|index|---|\+\+\+)[^\n]*`, 'comment']],
};

const compiled = new Map<Family, RegExp>();
function regexFor(f: Family): RegExp {
  let re = compiled.get(f);
  if (!re) {
    re = new RegExp(RULES[f].map(([src]) => `(${src})`).join('|'), f === 'sql' ? 'gim' : 'gm');
    compiled.set(f, re);
  }
  re.lastIndex = 0;
  return re;
}

export function languageOf(lang?: string): Family | undefined {
  return ALIASES[(lang ?? '').trim().toLowerCase().split(/[\s{]/)[0]];
}

/** Split code into coloured spans. Unknown languages and very long code come back as one plain span. */
export function highlight(code: string, lang?: string): Span[] {
  const family = languageOf(lang);
  if (!family || code.length > 40_000) return [{ text: code }];
  const rules = RULES[family];
  const keywords = KEYWORDS[family];
  const re = regexFor(family);
  const out: Span[] = [];
  const push = (text: string, kind?: SynKind) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (!m[0]) { re.lastIndex++; continue; }
    push(code.slice(at, m.index));
    const rule = rules[m.slice(1).findIndex((g) => g !== undefined)];
    const kind = rule?.[1];
    const text = m[0];
    const next = code.slice(re.lastIndex).match(/^\s*(\S)/)?.[1];
    if (kind === 'word') {
      const known = keywords?.has(family === 'sql' ? text.toLowerCase() : text);
      push(text, known ? 'keyword' : next === '(' ? 'function' : /^[A-Z][a-z]/.test(text) && family !== 'sql' ? 'type' : undefined);
    } else if (kind === 'key') {
      push(text, next === ':' ? 'function' : 'string');
    } else if (kind === 'var') {
      push(text, 'type');
    } else if (kind === 'cmd') {
      const before = code.slice(code.lastIndexOf('\n', m.index - 1) + 1, m.index).trim();
      const command = before === '' || before === '$' || /[|;&(]$/.test(before) || /^(sudo|exec|time|xargs)$/.test(before.split(/\s+/).pop() ?? '');
      push(text, keywords?.has(text) ? 'keyword' : command ? 'function' : undefined);
    } else {
      push(text, kind);
    }
    at = re.lastIndex;
  }
  push(code.slice(at));
  return out;
}

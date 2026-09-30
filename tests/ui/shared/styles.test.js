import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

const extensionRoot = new URL('../../../extension/', import.meta.url);

function listStyles(directory = extensionRoot) {
  return readdirSync(directory).flatMap((name) => {
    const url = new URL(name, directory);
    return statSync(url).isDirectory()
      ? listStyles(new URL(`${name}/`, directory))
      : name.endsWith('.css') ? [url] : [];
  });
}

test('each imported stylesheet contains complete rules and resolves its dependencies', () => {
  for (const url of listStyles()) {
    const source = readFileSync(url, 'utf8');
    const rules = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"\n]*"|'[^'\n]*'/g, '');
    let depth = 0;
    for (const character of rules) {
      if (character === '{') depth++;
      if (character === '}') depth--;
      assert.ok(depth >= 0, `Unexpected closing brace in ${url}`);
    }
    assert.equal(depth, 0, `Unclosed rule in ${url}`);
    for (const match of source.matchAll(/@import\s+url\(["']([^"']+)["']\);/g)) {
      const dependency = new URL(match[1], url);
      assert.ok(dependency.href.startsWith(extensionRoot.href), `${url} imports outside extension/`);
      assert.ok(statSync(dependency).isFile(), `Missing stylesheet imported by ${url}`);
    }
  }
});

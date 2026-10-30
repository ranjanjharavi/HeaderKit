import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

const extensionRoot = new URL('../../extension/', import.meta.url);

function listModules(directory = extensionRoot) {
  return readdirSync(directory).flatMap((name) => {
    const url = new URL(name, directory);
    return statSync(url).isDirectory()
      ? listModules(new URL(`${name}/`, directory))
      : name.endsWith('.js')
        ? [url]
        : [];
  });
}

function getDependencies(url) {
  const source = readFileSync(url, 'utf8');
  return [...source.matchAll(/^import\s+[\s\S]*?\sfrom\s*['"]([^'"]+)['"]/gm)].map((match) => {
    assert.ok(match[1].startsWith('.'), `Browser module needs a relative import: ${url}`);
    return new URL(match[1], url);
  });
}

test('every browser module dependency exists inside the unpacked extension', () => {
  for (const module of listModules()) {
    for (const dependency of getDependencies(module)) {
      assert.ok(dependency.href.startsWith(extensionRoot.href), `${module} imports outside extension/`);
      assert.ok(statSync(dependency).isFile(), `${module} imports a missing module`);
    }
  }
});

test('extension modules have no circular imports', () => {
  const visited = new Set();
  const visiting = new Set();

  function visit(module) {
    assert.ok(!visiting.has(module.href), `Circular import through ${module}`);
    if (visited.has(module.href)) return;
    visiting.add(module.href);
    getDependencies(module).forEach(visit);
    visiting.delete(module.href);
    visited.add(module.href);
  }

  listModules().forEach(visit);
});

test('manifest entry points and icons resolve inside the unpacked extension', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', extensionRoot), 'utf8'));
  const paths = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon)
  ];
  paths.forEach((path) => assert.ok(statSync(new URL(path, extensionRoot)).isFile(), path));
});

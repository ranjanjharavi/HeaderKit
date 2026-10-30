import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import test from 'node:test';

const docsRoot = new URL('../../../docs/', import.meta.url);
const publishedRoot = new URL('https://ranjanjharavi.github.io/HeaderKit/');
const imageRoot = new URL('assets/img/', publishedRoot);

function checkAssetReferences(source, page) {
  const references = [
    ...source.matchAll(/\b(?:src|href|content)=["']([^"']+)["']/g),
    ...source.matchAll(/"(?:image|screenshot)":\s*"([^"]+)"/g)
  ]
    .map((match) => match[1])
    .filter((reference) => reference.includes('assets/'));
  assert.ok(references.length, `No asset references checked for ${page}`);
  for (const reference of new Set(references)) {
    const url = new URL(reference, new URL(page, publishedRoot));
    assert.equal(url.origin, publishedRoot.origin, reference);
    assert.ok(url.pathname.startsWith(publishedRoot.pathname), reference);
    const file = new URL(url.pathname.slice(publishedRoot.pathname.length), docsRoot);
    assert.ok(statSync(file).isFile(), `${page}: ${reference}`);
    if (/\.(?:png|svg|jpe?g|gif|webp|avif|ico)$/i.test(url.pathname)) {
      assert.ok(url.pathname.startsWith(imageRoot.pathname), `Image outside assets/img/: ${reference}`);
    }
    if (url.pathname.endsWith('.svg') && url.hash) {
      const ids = [...readFileSync(file, 'utf8').matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
      assert.ok(ids.includes(decodeURIComponent(url.hash.slice(1))), `Missing SVG fragment: ${reference}`);
    }
  }
}

for (const page of readdirSync(docsRoot, { recursive: true }).filter((path) => path.endsWith('.html'))) {
  test(`${page} resolves assets, social images, structured data, and SVG fragments under the published site path`, () => {
    checkAssetReferences(readFileSync(new URL(page, docsRoot), 'utf8'), page);
  });
}

test('privacy page generation uses valid website asset paths too', () => {
  const source = readFileSync(new URL('../../../scripts/build-privacy.mjs', import.meta.url), 'utf8');
  checkAssetReferences(source, 'privacy-policy.html');
});

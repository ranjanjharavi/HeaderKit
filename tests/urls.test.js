import assert from 'node:assert/strict';
import test from 'node:test';

import { parseUserUrl } from '../extension/shared/domain/urls.js';

test('parseUserUrl defaults to HTTPS and preserves the URL port', () => {
  assert.equal(parseUserUrl('https://example.com:8443/path').url.hostname, 'example.com');
  assert.equal(parseUserUrl('example.com/path').url.href, 'https://example.com/path');
  assert.equal(parseUserUrl('https://example.com:8443/path').url.origin, 'https://example.com:8443');
});

test('parseUserUrl permits HTTP only for local development', () => {
  assert.equal(parseUserUrl('http://localhost:3000/path').url.origin, 'http://localhost:3000');
  assert.equal(parseUserUrl('http://127.0.0.1:8080').url.origin, 'http://127.0.0.1:8080');
  assert.equal(parseUserUrl('http://[::1]:9000').url.origin, 'http://[::1]:9000');
  assert.throws(() => parseUserUrl('http://example.com/path'), /local development/);
});

test('parseUserUrl rejects unsupported protocols and embedded credentials', () => {
  assert.throws(() => parseUserUrl('chrome://extensions'), /Unsupported/);
  assert.throws(() => parseUserUrl('file:///tmp/example'), /Unsupported/);
  assert.throws(() => parseUserUrl('https://user:pass@example.com'), /Credentials/);
});

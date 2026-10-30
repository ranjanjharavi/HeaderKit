import { readFileSync } from 'node:fs';

export function readSource(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

export function readStyles(path) {
  const sourceUrl = new URL(`../../${path}`, import.meta.url);
  return expandStyles(sourceUrl);
}

function expandStyles(sourceUrl) {
  return readFileSync(sourceUrl, 'utf8').replace(/@import\s+url\(["']([^"']+)["']\);/g, (_match, path) =>
    expandStyles(new URL(path, sourceUrl))
  );
}

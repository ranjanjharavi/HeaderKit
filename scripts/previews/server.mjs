import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};
const previewPages = new Set(['/extension/options/index.html', '/extension/popup/index.html']);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    let path = resolve(root, '.' + pathname);
    if (pathname.endsWith('/')) {
      path = resolve(path, 'index.html');
    }
    const allowed = ['/extension/', '/docs/', '/scripts/previews/'].some((directory) => (
      path.startsWith(root + directory)
    ));
    if (!allowed) {
      response.writeHead(404).end();
      return;
    }

    let content = await readFile(path);
    if (previewPages.has(pathname)) {
      content = content.toString().replace('<head>', '<head>\n  <script type="module" src="/scripts/previews/fixture.js"></script>');
    }
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' });
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  console.log(`HeaderKit previews: http://127.0.0.1:${address.port}/scripts/previews/store-screenshot.html?view=manager`);
});

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(projectRoot, 'privacy/policy.md');
const extensionTarget = resolve(projectRoot, 'extension/privacy/index.html');
const docsTarget = resolve(projectRoot, 'docs/privacy-policy.html');
const markdown = await readFile(sourcePath, 'utf8');
const body = renderMarkdown(markdown);

await Promise.all([
  writeExtensionPrivacyPage(extensionTarget, body),
  writeDocsPrivacyPage(docsTarget, body)
]);

async function writeExtensionPrivacyPage(target, renderedBody) {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ReqKit Privacy Policy</title>
  <style>${getExtensionStyles()}</style>
</head>
<body>
  <main>
    <header><img src="../icons/reqkit-128.png" width="64" height="64" alt="ReqKit"><div><span class="eyebrow">ReqKit</span><span>Request-header privacy</span></div></header>
    <span class="purpose-badge">Built for API and web-environment testing</span>
    ${renderedBody}
  </main>
</body>
</html>
`, 'utf8');
}

async function writeDocsPrivacyPage(target, renderedBody) {
  await mkdir(dirname(target), { recursive: true });
  const articleBody = renderedBody.replace(/^\s*<h1[^>]*>.*?<\/h1>\s*/, '');
  await writeFile(target, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Review local storage, request headers, and Chrome permissions.">
  <meta name="theme-color" content="#eff6ff">
  <meta property="og:title" content="ReqKit Privacy Policy">
  <meta property="og:description" content="Local data, exact-host access, and plaintext header values.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://ranjanjharavi.github.io/ReqKit/privacy-policy.html">
  <meta property="og:image" content="https://ranjanjharavi.github.io/ReqKit/assets/reqkit-headers-screenshot.png">
  <meta property="og:image:alt" content="ReqKit showing exact-host request-header rules">
  <link rel="canonical" href="https://ranjanjharavi.github.io/ReqKit/privacy-policy.html">
  <link rel="icon" type="image/png" href="assets/reqkit-128.png">
  <link rel="stylesheet" href="assets/site.css">
  <title>Privacy Policy — ReqKit</title>
</head>
<body>
  <header class="site-header">
    <nav class="nav-shell" aria-label="Primary navigation">
      <a class="brand" href="./" aria-label="ReqKit home">
        <img src="assets/reqkit-128.png" width="38" height="38" alt="">
        <span>ReqKit</span>
      </a>
      <div class="nav-links">
        <a href="./">Home</a>
        <a href="index.html#features">Features</a>
        <a aria-current="page" href="privacy-policy.html">Privacy</a>
        <a class="nav-github" href="https://github.com/ranjanjharavi/ReqKit">GitHub <span aria-hidden="true">↗</span></a>
      </div>
    </nav>
  </header>

  <main class="privacy-main section-shell">
    <section class="privacy-hero">
      <div class="privacy-hero-copy">
        <span class="section-kicker">Request-header privacy</span>
        <h1>Local data. Exact hosts.</h1>
        <p>Keep settings in Chrome. Send active header values only to approved exact HTTPS hosts. No developer uploads.</p>
        <span class="purpose-badge">Built for API and web-environment testing</span>
      </div>
      <div class="privacy-hero-mark" aria-hidden="true">
        <svg viewBox="0 0 64 64"><path d="M32 7 13 15v14c0 13 7.5 22.5 19 28 11.5-5.5 19-15 19-28V15L32 7Z"/><path d="m23 32 6 6 13-15"/></svg>
      </div>
    </section>

    <section class="privacy-highlights" aria-label="Privacy highlights">
      <article class="privacy-highlight"><strong>No analytics</strong><span>No telemetry, ads, accounts, or developer API.</span></article>
      <article class="privacy-highlight"><strong>Local Chrome storage</strong><span>Save profiles, rules, activation, and consent in <code>chrome.storage.local</code>.</span></article>
      <article class="privacy-highlight"><strong>On-demand site access</strong><span>Grant exact-host access on demand. No all-site access by default.</span></article>
    </section>

    <div class="privacy-layout">
      <aside class="privacy-toc">
        <strong>On this page</strong>
        <nav aria-label="Privacy policy sections">
          <a href="#data-reqkit-handles">Data handled</a>
          <a href="#how-data-is-used-and-transmitted">Use &amp; transmission</a>
          <a href="#retention-and-deletion">Retention</a>
          <a href="#permissions">Permissions</a>
          <a href="#security-and-responsible-use">Security</a>
          <a href="#data-sharing-and-sale">Sharing &amp; sale</a>
          <a href="#contact">Contact</a>
        </nav>
      </aside>
      <article class="privacy-prose">
        ${articleBody}
      </article>
    </div>
  </main>

  <footer class="site-footer">
    <div class="footer-shell">
      <a class="brand" href="./"><img src="assets/reqkit-128.png" width="32" height="32" alt=""><span>ReqKit</span></a>
      <p>Test API and web environments.</p>
      <div class="footer-links"><a href="privacy-policy.html">Privacy</a><a href="https://github.com/ranjanjharavi/ReqKit/issues">Support</a><a href="https://github.com/ranjanjharavi/ReqKit">Source</a></div>
    </div>
  </footer>
</body>
</html>
`, 'utf8');
}

function renderMarkdown(source) {
  const lines = source.trim().split(/\r?\n/);
  const output = [];
  let paragraph = [];
  let listType = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listType) {
      output.push(`</${listType}>`);
      listType = null;
    }
  };

  lines.forEach((line) => {
    const heading = /^(#{1,2})\s+(.+)$/.exec(line);
    const listItem = /^[-*]\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      const id = level === 2 ? ` id="${slugify(heading[2])}"` : '';
      output.push(`<h${level}${id}>${renderInline(heading[2])}</h${level}>`);
    } else if (listItem) {
      flushParagraph();
      if (listType !== 'ul') {
        closeList();
        output.push('<ul>');
        listType = 'ul';
      }
      output.push(`<li>${renderInline(listItem[1])}</li>`);
    } else if (!line.trim()) {
      flushParagraph();
      closeList();
    } else {
      paragraph.push(line.trim());
    }
  });
  flushParagraph();
  closeList();
  return output.join('\n    ');
}

function renderInline(value) {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function getExtensionStyles() {
  return `
:root{color-scheme:light;--blue:#2563eb;--blue-deep:#1d4ed8;--blue-soft:#eff6ff;--border:#bfdbfe;--ink:#0f172a;--ink-soft:#334155;--muted:#64748b;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:var(--blue-soft)}
*{box-sizing:border-box}body{margin:0;padding:40px 20px;background:linear-gradient(145deg,#eaf3ff,#f8fbff 48%,#eaf2ff)}
main{max-width:760px;margin:0 auto;padding:40px;border:1px solid var(--border);border-radius:18px;background:#fff;box-shadow:0 24px 70px rgba(30,64,175,.13)}
header{display:flex;align-items:center;gap:16px;padding-bottom:22px;border-bottom:1px solid #dbeafe;color:var(--muted);font-size:13px}header img{border-radius:14px}
.eyebrow{display:block;margin-bottom:4px;color:var(--blue);font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.purpose-badge{display:inline-flex;margin-top:20px;padding:7px 10px;border:1px solid var(--border);border-radius:12px;background:var(--blue-soft);color:var(--blue-deep);font-size:11px;font-weight:700;line-height:1.35}
h1{margin:28px 0 4px;font-size:30px;letter-spacing:-.02em}h1+p{margin-top:0;color:#64748b;font-size:13px}h2{margin:30px 0 10px;font-size:18px}
p,li{color:var(--ink-soft);font-size:15px;line-height:1.65}li+li{margin-top:8px}code{padding:2px 5px;border-radius:5px;background:var(--blue-soft);color:#1e40af;overflow-wrap:anywhere}a{color:var(--blue-deep)}
@media(max-width:600px){body{padding:0}main{padding:26px 20px;border:0;border-radius:0}}
`;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

export function parseUserUrl(value) {
  const input = String(value || '').trim();
  if (!input) {
    throw new Error('Missing URL');
  }

  const hadHttpProtocol = isHttpUrl(input);
  const hadOtherProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(input) && !hadHttpProtocol;
  if (hadOtherProtocol) {
    throw new Error('Unsupported URL');
  }

  const candidate = hadHttpProtocol ? input : `https://${input.replace(/^\/+/, '')}`;
  if (!URL.canParse(candidate)) {
    throw new Error('Unsupported URL');
  }

  const parsed = new URL(candidate);
  if (!parsed.hostname || !isHttpUrl(parsed.href)) {
    throw new Error('Unsupported URL');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Credentials in URLs are not supported');
  }

  if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) {
    throw new Error('HTTP is supported only for local development');
  }

  return { url: parsed };
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '[::1]'
    || normalized === '::1';
}

/** Client-side curl parse and local URL conversion (no server needed). */
const CurlConvert = (() => {
  function normalizeCurlText(text) {
    let t = text.trim();
    if (t.toLowerCase().startsWith('curl')) t = t.slice(4).trim();
    t = t.replace(/\\\s*\n/g, ' ');
    t = t.replace(/\s+/g, ' ');
    return t;
  }

  function shellSplit(text) {
    const parts = [];
    let current = '';
    let quote = null;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) quote = null;
        else current += c;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ' ') {
        if (current) {
          parts.push(current);
          current = '';
        }
      } else {
        current += c;
      }
    }
    if (current) parts.push(current);
    return parts;
  }

  function parseCurl(text) {
    const normalized = normalizeCurlText(text);
    if (!normalized) throw new Error('请输入 curl 命令');

    const parts = shellSplit(normalized);
    let url = null;
    let method = 'GET';
    const headers = {};
    const cookies = {};
    let body = null;

    let i = 0;
    while (i < parts.length) {
      const arg = parts[i];
      if (arg === '-X' || arg === '--request') {
        i += 1;
        if (i >= parts.length) throw new Error('缺少请求方法');
        method = parts[i].toUpperCase();
      } else if (arg === '-H' || arg === '--header') {
        i += 1;
        if (i >= parts.length) throw new Error('缺少 header 内容');
        const header = parts[i];
        if (header.includes(':')) {
          const idx = header.indexOf(':');
          headers[header.slice(0, idx).trim()] = header.slice(idx + 1).trim();
        }
      } else if (arg === '-b' || arg === '--cookie') {
        i += 1;
        if (i >= parts.length) throw new Error('缺少 cookie 内容');
        parts[i].split(';').forEach(item => {
          const piece = item.trim();
          if (piece.includes('=')) {
            const idx = piece.indexOf('=');
            cookies[piece.slice(0, idx).trim()] = piece.slice(idx + 1).trim();
          }
        });
      } else if (['-d', '--data', '--data-raw', '--data-binary'].includes(arg)) {
        i += 1;
        if (i >= parts.length) throw new Error('缺少 body 内容');
        body = parts[i];
        if (method === 'GET') method = 'POST';
      } else if (arg.startsWith('http://') || arg.startsWith('https://')) {
        url = arg;
      } else if (!arg.startsWith('-') && url === null) {
        url = arg;
      }
      i += 1;
    }

    if (!url) throw new Error('未找到请求 URL');

    if (Object.keys(cookies).length) {
      const hasCookie = Object.keys(headers).some(k => k.toLowerCase() === 'cookie');
      if (!hasCookie) {
        headers.Cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
      }
    }

    return { url, method, headers, body };
  }

  function normalizePortMappings(mappings, defaultPort) {
    const result = {};
    const list = Array.isArray(mappings) ? mappings : [];
    list.forEach(item => {
      const key = String(item.domain || '').toLowerCase().trim();
      const p = parseInt(item.port, 10);
      if (key && p >= 1 && p <= 65535) result[key] = p;
    });
    return result;
  }

  function resolvePortForHost(host, defaultPort, portMappings) {
    const h = (host || '').toLowerCase().trim();
    return portMappings[h] ?? defaultPort;
  }

  function resolvePortFromUrl(url, defaultPort, portMappings) {
    const host = new URL(url).hostname.toLowerCase();
    if (portMappings[host] != null) return [portMappings[host], host];
    return [defaultPort, null];
  }

  function toLocalUrl(url, port) {
    const u = new URL(url);
    let path = u.pathname || '/';
    if (u.search) path += u.search;
    return `http://127.0.0.1:${port}${path}`;
  }

  function localizeHeaders(headers, defaultPort, portMappings) {
    const result = { ...headers };
    Object.keys(result).forEach(key => {
      const lower = key.toLowerCase();
      if (lower === 'origin' || lower === 'referer') {
        try {
          const u = new URL(result[key]);
          const port = resolvePortForHost(u.hostname, defaultPort, portMappings);
          if (lower === 'origin') {
            result[key] = `http://127.0.0.1:${port}`;
          } else {
            result[key] = `http://127.0.0.1:${port}${u.pathname || '/'}`;
          }
        } catch {
          /* keep original */
        }
      }
    });
    return result;
  }

  function buildCurl(parsed, localUrl) {
    const lines = [`curl '${localUrl}'`];
    if (parsed.method !== 'GET') lines.push(`  -X ${parsed.method}`);
    Object.entries(parsed.headers).forEach(([name, value]) => {
      lines.push(`  -H '${name}: ${value}'`);
    });
    if (parsed.body) {
      lines.push(`  -d '${parsed.body.replace(/'/g, "'\\''")}'`);
    }
    return lines.join(' \\\n');
  }

  function convertCurl(text, port, portMappings) {
    const parsed = parseCurl(text);
    const mappings = normalizePortMappings(portMappings, port);
    const [usedPort, matchedDomain] = resolvePortFromUrl(parsed.url, port, mappings);
    const localUrl = toLocalUrl(parsed.url, usedPort);
    const localHeaders = localizeHeaders(parsed.headers, port, mappings);
    const request = {
      url: localUrl,
      method: parsed.method,
      headers: localHeaders,
      body: parsed.body,
    };
    return {
      original_url: parsed.url,
      local_url: localUrl,
      local_curl: buildCurl({ ...parsed, headers: localHeaders }, localUrl),
      request,
      used_port: usedPort,
      matched_domain: matchedDomain,
    };
  }

  return { convertCurl };
})();

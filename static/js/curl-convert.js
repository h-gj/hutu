/** Client-side curl parse and local URL conversion (no server needed). */
const CurlConvert = (() => {
  const BODY_PLACEHOLDER = '__HUTU_BODY__';
  const DATA_FLAGS = ['--data-raw', '--data-binary', '--data', '-d'];

  function decodeCurlEscapes(str) {
    return str
      .replace(/\\r/g, '\r')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  /** Normalize body text: unwrap bash $'...' / '...' and decode literal \\r\\n sequences. */
  function normalizeBodyText(body) {
    if (!body) return body;
    let t = body.trim();
    if (t.startsWith("$'") && t.endsWith("'")) {
      t = decodeCurlEscapes(t.slice(2, -1));
    } else if (t.startsWith("'") && t.endsWith("'")) {
      t = decodeCurlEscapes(t.slice(1, -1));
    } else if (t.startsWith('"') && t.endsWith('"')) {
      t = decodeCurlEscapes(t.slice(1, -1));
    }
    if (t.includes('\\r') || t.includes('\\n') || t.includes('\\t')) {
      t = decodeCurlEscapes(t);
    }
    return t;
  }

  function extractEmbeddedBody(raw) {
    const flagPattern = '(?:--data-raw|--data-binary|--data|-d)';
    const patterns = [
      new RegExp(`${flagPattern}\\s+\\$'((?:\\\\.|[^'])*)'`, 'i'),
      new RegExp(`${flagPattern}\\s+\\$\\s*'((?:\\\\.|[^'])*)'`, 'i'),
      new RegExp(`${flagPattern}\\s+'((?:\\\\.|[^'])*)'`, 'i'),
      new RegExp(`${flagPattern}\\s+"((?:\\\\.|[^"])*)"`, 'i'),
    ];

    for (const pattern of patterns) {
      const m = pattern.exec(raw);
      if (!m) continue;
      const body = decodeCurlEscapes(m[1]);
      const replacement = `-d ${BODY_PLACEHOLDER}`;
      const text = raw.slice(0, m.index) + replacement + raw.slice(m.index + m[0].length);
      return { text, body };
    }

    // Fallback: locate --data-raw / -d then manually extract $'...' or '...'
    const flagRe = /(?:--data-raw|--data-binary|--data|-d)/gi;
    let flagMatch;
    while ((flagMatch = flagRe.exec(raw)) !== null) {
      let i = flagMatch.index + flagMatch[0].length;
      while (i < raw.length && /\s/.test(raw[i])) i += 1;
      if (i >= raw.length) continue;

      let body = null;
      let end = i;

      if (raw[i] === '$') {
        i += 1;
        while (i < raw.length && /\s/.test(raw[i])) i += 1;
      }

      if (raw[i] === "'") {
        i += 1;
        const start = i;
        while (i < raw.length) {
          if (raw[i] === '\\') {
            i += 2;
            continue;
          }
          if (raw[i] === "'") {
            body = decodeCurlEscapes(raw.slice(start, i));
            end = i + 1;
            break;
          }
          i += 1;
        }
      } else if (raw[i] === '"') {
        i += 1;
        const start = i;
        while (i < raw.length) {
          if (raw[i] === '\\') {
            i += 2;
            continue;
          }
          if (raw[i] === '"') {
            body = decodeCurlEscapes(raw.slice(start, i));
            end = i + 1;
            break;
          }
          i += 1;
        }
      }

      if (body) {
        const text = raw.slice(0, flagMatch.index) + `-d ${BODY_PLACEHOLDER}` + raw.slice(end);
        return { text, body };
      }
    }

    return { text: raw, body: null };
  }

  function normalizeCurlText(text) {
    let t = text.trim();
    if (t.toLowerCase().startsWith('curl')) t = t.slice(4).trim();
    t = t.replace(/\\\s*\n/g, ' ');
    const extracted = extractEmbeddedBody(t);
    t = extracted.text.replace(/\s+/g, ' ');
    return { normalized: t, extractedBody: extracted.body };
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

  function getContentType(headers) {
    const entry = Object.entries(headers || {}).find(([k]) => k.toLowerCase() === 'content-type');
    return entry ? entry[1] : '';
  }

  function parseMultipartFormRows(body, contentType) {
    const rows = [];
    const normalized = normalizeBodyText(body);
    if (!normalized) return rows;

    let boundary = null;
    const ctMatch = (contentType || '').match(/boundary=([^;\s]+)/i);
    if (ctMatch) boundary = ctMatch[1].replace(/^["']|["']$/g, '');

    if (!boundary) {
      const startMatch = normalized.match(/^--([^\r\n]+)/);
      boundary = startMatch ? startMatch[1] : null;
    }
    if (!boundary) return rows;

    const delimiter = `--${boundary}`;
    const segments = normalized.split(delimiter);
    segments.forEach(segment => {
      const trimmed = segment.replace(/^\r\n/, '').replace(/\r\n$/, '');
      if (!trimmed || trimmed === '--') return;

      const nameMatch = trimmed.match(/name="([^"]+)"/i) || trimmed.match(/name=([^;\r\n]+)/i);
      if (!nameMatch) return;

      const key = nameMatch[1].trim().replace(/^["']|["']$/g, '');
      let bodyStart = trimmed.search(/\r\n\r\n/);
      if (bodyStart < 0) bodyStart = trimmed.indexOf('\\r\\n\\r\\n');
      if (bodyStart < 0) bodyStart = trimmed.indexOf('\n\n');
      if (bodyStart < 0) return;

      const sepLen = trimmed.slice(bodyStart).startsWith('\\r\\n\\r\\n') ? 8
        : trimmed.slice(bodyStart).startsWith('\n\n') ? 2
        : 4;

      let value = trimmed.slice(bodyStart + sepLen);
      value = value.replace(/\r\n--$/, '').replace(/\r\n$/, '').replace(/\\r\\n--$/, '').replace(/\\r\\n$/, '').trim();

      const fileMatch = trimmed.match(/filename="([^"]+)"/i);
      if (fileMatch) value = `@${fileMatch[1]}`;

      rows.push({ key, value, enabled: true });
    });

    return rows;
  }

  function parseFormField(raw) {
    const eqIdx = raw.indexOf('=');
    if (eqIdx < 0) return null;
    const key = raw.slice(0, eqIdx).trim();
    if (!key) return null;

    let value = raw.slice(eqIdx + 1).trim();
    if (value.startsWith('@')) {
      const semi = value.indexOf(';');
      const fileRef = semi >= 0 ? value.slice(1, semi) : value.slice(1);
      value = `@${fileRef.trim()}`;
    }

    return { key, value, enabled: true };
  }

  function parseCurl(text) {
    const { normalized, extractedBody } = normalizeCurlText(text);
    if (!normalized) throw new Error('请输入 curl 命令');

    const parts = shellSplit(normalized);
    let url = null;
    let method = 'GET';
    const headers = {};
    const cookies = {};
    let body = extractedBody;
    const formFields = [];

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
      } else if (['-F', '--form', '--form-string'].includes(arg)) {
        i += 1;
        if (i >= parts.length) throw new Error('缺少 form 内容');
        const field = parseFormField(parts[i]);
        if (field) formFields.push(field);
        if (method === 'GET') method = 'POST';
      } else if (DATA_FLAGS.includes(arg) || arg === '-d') {
        i += 1;
        if (i >= parts.length) throw new Error('缺少 body 内容');
        const part = parts[i];
        if (part === BODY_PLACEHOLDER && extractedBody) {
          body = extractedBody;
        } else if (!body) {
          body = part;
        }
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

    let bodyMeta = null;

    if (formFields.length > 0) {
      body = null;
      bodyMeta = { type: 'form-data', formRows: formFields };
      Object.keys(headers).forEach(key => {
        if (key.toLowerCase() === 'content-type') delete headers[key];
      });
    } else if (body) {
      body = normalizeBodyText(body);
      const ct = getContentType(headers);
      const isMultipart = ct.toLowerCase().includes('multipart/form-data')
        || body.includes('Content-Disposition: form-data');
      if (isMultipart) {
        const rows = parseMultipartFormRows(body, ct);
        if (rows.length > 0) {
          bodyMeta = { type: 'form-data', formRows: rows };
          body = null;
          Object.keys(headers).forEach(key => {
            if (key.toLowerCase() === 'content-type') delete headers[key];
          });
        }
      } else if (ct.toLowerCase().includes('application/x-www-form-urlencoded')) {
        const rows = [];
        try {
          const params = new URLSearchParams(body);
          params.forEach((value, key) => rows.push({ key, value, enabled: true }));
        } catch { /* ignore */ }
        if (rows.length) {
          bodyMeta = { type: 'urlencoded', urlencodedRows: rows };
          body = null;
        }
      } else if (ct.toLowerCase().includes('application/graphql')) {
        try {
          const parsed = JSON.parse(body);
          if (parsed.query) {
            bodyMeta = {
              type: 'graphql',
              graphqlQuery: parsed.query,
              graphqlVariables: JSON.stringify(parsed.variables || {}, null, 2),
            };
            body = null;
          }
        } catch { /* raw */ }
      } else {
        let rawSubtype = 'text';
        if (ct.toLowerCase().includes('json')) rawSubtype = 'json';
        else if (ct.toLowerCase().includes('javascript')) rawSubtype = 'javascript';
        else if (ct.toLowerCase().includes('html')) rawSubtype = 'html';
        else if (ct.toLowerCase().includes('xml')) rawSubtype = 'xml';
        else if (body.trim().startsWith('{') || body.trim().startsWith('[')) rawSubtype = 'json';
        bodyMeta = { type: 'raw', rawSubtype, rawText: body };
      }
    }

    return { url, method, headers, body, bodyMeta };
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
      const escaped = String(value).replace(/'/g, "'\\''");
      lines.push(`  -H '${name}: ${escaped}'`);
    });
    if (parsed.bodyMeta?.type === 'form-data' && parsed.bodyMeta.formRows?.length) {
      parsed.bodyMeta.formRows.forEach(row => {
        if (!row.key) return;
        const escaped = `${row.key}=${row.value}`.replace(/'/g, "'\\''");
        lines.push(`  -F '${escaped}'`);
      });
    } else if (parsed.body) {
      if (parsed.body_encoding === 'base64') {
        const name = parsed.bodyMeta?.binaryFilename || 'file.bin';
        lines.push(`  --data-binary '@${name.replace(/'/g, "'\\''")}'`);
      } else {
        const escaped = String(parsed.body).replace(/'/g, "'\\''");
        lines.push(`  -d '${escaped}'`);
      }
    }
    return lines.join(' \\\n');
  }

  function convertCurl(text, port, portMappings) {
    const parsed = parseCurl(text);
    const mappings = normalizePortMappings(portMappings, port);
    const [usedPort, matchedDomain] = resolvePortFromUrl(parsed.url, port, mappings);
    const localUrl = toLocalUrl(parsed.url, usedPort);
    const localHeaders = localizeHeaders(parsed.headers, port, mappings);
    if (parsed.bodyMeta?.type === 'form-data') {
      Object.keys(localHeaders).forEach(key => {
        if (key.toLowerCase() === 'content-type') delete localHeaders[key];
      });
    }
    const request = {
      url: localUrl,
      method: parsed.method,
      headers: localHeaders,
      body: parsed.body,
      bodyMeta: parsed.bodyMeta,
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

  function buildCurlFromRequest(request) {
    return buildCurl({
      method: request.method || 'GET',
      headers: request.headers || {},
      body: request.body,
      body_encoding: request.body_encoding,
      bodyMeta: request.bodyMeta,
    }, request.url);
  }

  return { convertCurl, parseCurl, buildCurlFromRequest };
})();

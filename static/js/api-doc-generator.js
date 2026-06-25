/** Build Markdown API doc from request + response for frontend handoff. */
const ApiDocGenerator = (() => {
  function escapeTableCell(text) {
    return String(text ?? '')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ');
  }

  function tryFormatJson(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return null;
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return null;
    }
  }

  function fenceLang(body, contentType) {
    const ct = (contentType || '').toLowerCase();
    const trimmed = (body || '').trim();
    if (!trimmed) return 'text';
    if (ct.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
    if (ct.includes('xml') || trimmed.startsWith('<')) return 'xml';
    if (ct.includes('html')) return 'html';
    if (ct.includes('javascript')) return 'javascript';
    return 'text';
  }

  function formatBodyBlock(body, contentType) {
    const trimmed = (body || '').trim();
    if (!trimmed) return '_无请求体_';
    const formatted = tryFormatJson(trimmed);
    const lang = fenceLang(body, contentType);
    const text = formatted || body;
    return `\`\`\`${lang}\n${text}\n\`\`\``;
  }

  function getContentType(headers) {
    const entry = Object.entries(headers || {}).find(([k]) => k.toLowerCase() === 'content-type');
    return entry ? entry[1] : '';
  }

  function parseUrlParts(url) {
    try {
      const u = new URL(url);
      return {
        origin: u.origin,
        pathname: u.pathname,
        search: u.search,
        host: u.host,
      };
    } catch {
      return { origin: '', pathname: url || '', search: '', host: '' };
    }
  }

  function kvTable(rows, columns) {
    if (!rows.length) return '_无_';
    const header = `| ${columns.map(c => c.title).join(' | ')} |`;
    const sep = `| ${columns.map(() => '---').join(' | ')} |`;
    const body = rows.map(row => {
      return `| ${columns.map(c => escapeTableCell(row[c.key] ?? '')).join(' | ')} |`;
    }).join('\n');
    return `${header}\n${sep}\n${body}`;
  }

  function paramsFromUrl(url) {
    const rows = [];
    try {
      const u = new URL(url);
      u.searchParams.forEach((value, key) => {
        rows.push({ name: key, example: value, required: '', desc: '' });
      });
    } catch { /* ignore */ }
    return rows;
  }

  function paramsFromRows(rows) {
    return (rows || [])
      .filter(r => r.enabled && r.key)
      .map(r => ({ name: r.key, example: r.value, required: '', desc: '' }));
  }

  function headersTable(headers) {
    const skip = new Set(['content-length', 'host', 'connection', 'accept-encoding']);
    const rows = Object.entries(headers || {})
      .filter(([k]) => !skip.has(k.toLowerCase()))
      .map(([name, value]) => ({ name, value, desc: '' }));
    if (!rows.length) return '_无_';
    return kvTable(rows, [
      { key: 'name', title: 'Header' },
      { key: 'value', title: '值' },
      { key: 'desc', title: '说明' },
    ]);
  }

  function buildTitle(method, url) {
    const { pathname } = parseUrlParts(url);
    const path = pathname || url || '接口';
    return `${method || 'GET'} ${path}`;
  }

  function generate(request, response, meta = {}) {
    if (!request?.url) {
      return '# 接口文档\n\n请先配置请求 URL 并发送后再生成文档。';
    }

    const method = (request.method || 'GET').toUpperCase();
    const url = request.url;
    const headers = request.headers || {};
    const contentType = getContentType(headers);
    const { pathname, host } = parseUrlParts(url);
    const now = new Date().toLocaleString('zh-CN', { hour12: false });
    const originalCurl = meta.originalCurl || '';
    const localCurl = meta.localCurl || '';

    const queryRows = paramsFromRows(meta.paramRows);
    if (!queryRows.length) {
      queryRows.push(...paramsFromUrl(url));
    }

    const resp = response || {};
    const statusText = resp.status != null ? String(resp.status) : '—';
    const elapsedText = resp.elapsed_ms != null ? `${resp.elapsed_ms} ms` : '—';
    const responseBody = resp.body || resp.error || '';
    const responseFormatted = tryFormatJson(responseBody);
    const responseLang = fenceLang(responseBody, '');
    const responseBlock = responseBody.trim()
      ? `\`\`\`${responseLang}\n${responseFormatted || responseBody}\n\`\`\``
      : '_暂无响应，请先发送请求_';

    const bodyMeta = request.bodyMeta || meta.bodyMeta || {};
    let bodySection = '_无_';
    if (bodyMeta.type === 'raw' && (request.body || bodyMeta.rawText)) {
      bodySection = formatBodyBlock(request.body || bodyMeta.rawText, contentType);
    } else if (bodyMeta.type === 'form-data' && bodyMeta.formRows?.length) {
      const rows = bodyMeta.formRows.filter(r => r.key).map(r => ({
        name: r.key, example: r.value, required: '', desc: '',
      }));
      bodySection = kvTable(rows, [
        { key: 'name', title: '字段' },
        { key: 'example', title: '示例值' },
        { key: 'required', title: '必填' },
        { key: 'desc', title: '说明' },
      ]);
    } else if (bodyMeta.type === 'urlencoded' && bodyMeta.urlencodedRows?.length) {
      const rows = bodyMeta.urlencodedRows.filter(r => r.key).map(r => ({
        name: r.key, example: r.value, required: '', desc: '',
      }));
      bodySection = kvTable(rows, [
        { key: 'name', title: '字段' },
        { key: 'example', title: '示例值' },
        { key: 'required', title: '必填' },
        { key: 'desc', title: '说明' },
      ]);
    } else if (bodyMeta.type === 'graphql') {
      bodySection = `**Query**\n\n\`\`\`graphql\n${bodyMeta.graphqlQuery || ''}\n\`\`\`\n\n**Variables**\n\n${formatBodyBlock(bodyMeta.graphqlVariables || '{}', 'application/json')}`;
    } else if (request.body) {
      bodySection = formatBodyBlock(request.body, contentType);
    }

    const querySection = queryRows.length
      ? kvTable(queryRows, [
        { key: 'name', title: '参数名' },
        { key: 'example', title: '示例值' },
        { key: 'required', title: '必填' },
        { key: 'desc', title: '说明' },
      ])
      : '_无 Query 参数_';

    const lines = [
      `# ${buildTitle(method, url)}`,
      '',
      `> 由 Request Local 自动生成 · ${now}`,
      '',
      '## 概述',
      '',
      '| 项目 | 值 |',
      '| --- | --- |',
      `| 方法 | \`${method}\` |`,
      `| 路径 | \`${pathname}\` |`,
      `| 完整 URL | \`${url}\` |`,
      `| Host | \`${host}\` |`,
      `| 状态码 | \`${statusText}\` |`,
      `| 耗时 | \`${elapsedText}\` |`,
      '',
      '## Query 参数',
      '',
      querySection,
      '',
      '## 请求头 Headers',
      '',
      headersTable(headers),
      '',
      '## 请求体 Body',
      '',
      bodySection,
      '',
      '## 响应 Response',
      '',
      `状态码: **${statusText}** · 耗时: **${elapsedText}**`,
      '',
      responseBlock,
      '',
    ];

    if (localCurl) {
      lines.push('## 本地 cURL', '', '```bash', localCurl, '```', '');
    }
    if (originalCurl && originalCurl !== localCurl) {
      lines.push('## 原始 cURL', '', '```bash', originalCurl, '```', '');
    }

    lines.push('## 备注', '', '_前端可在此补充业务说明、错误码、鉴权方式等。_', '');

    return lines.join('\n');
  }

  return { generate };
})();

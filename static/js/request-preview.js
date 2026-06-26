/** Postman-style editable request preview (params / headers / body). */
const RequestPreview = (() => {
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  const BODY_TYPES = ['none', 'form-data', 'urlencoded', 'raw', 'binary', 'graphql'];
  const RAW_CONTENT_TYPES = {
    json: 'application/json',
    text: 'text/plain',
    javascript: 'application/javascript',
    html: 'text/html',
    xml: 'application/xml',
  };

  let onChange = null;
  let activeTab = 'params';
  let paramRows = [];
  let headerRows = [];
  let formDataRows = [];
  let urlencodedRows = [];
  let bodyType = 'none';
  let rawSubtype = 'json';
  let binaryBase64 = '';
  let binaryFilename = '';
  let syncTimer = null;
  let urlSyncLock = false;
  let urlInputTimer = null;

  const SAVE_DEBOUNCE_MS = 400;
  const STORAGE_MAX_BYTES = 512 * 1024;
  let storageKey = null;
  let persistEnabled = false;
  let saveStateTimer = null;
  let isRestoring = false;

  function resolveStorageKey(options) {
    if (options.storageKey) return options.storageKey;
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    return `hutu-request-preview:${path}`;
  }

  function schedulePersist() {
    if (!persistEnabled || isRestoring || !storageKey) return;
    clearTimeout(saveStateTimer);
    saveStateTimer = setTimeout(persistState, SAVE_DEBOUNCE_MS);
  }

  function trimRequestForStorage(request) {
    const trimmed = { ...request, headers: { ...request.headers } };
    const meta = trimmed.bodyMeta ? { ...trimmed.bodyMeta } : null;
    if (meta?.binaryBase64 && meta.binaryBase64.length > 120000) {
      meta.binaryBase64 = '';
      meta.binaryFilename = '';
      trimmed.body = null;
      trimmed.body_encoding = 'utf-8';
    }
    trimmed.bodyMeta = meta;
    return trimmed;
  }

  function persistState() {
    if (!persistEnabled || isRestoring || !storageKey) return;
    try {
      const request = trimRequestForStorage(buildRequest());
      if (!request.url?.trim()) {
        removeStoredState();
        return;
      }
      const payload = { request, activeTab };
      const json = JSON.stringify(payload);
      if (json.length > STORAGE_MAX_BYTES) return;
      localStorage.setItem(storageKey, json);
    } catch {
      /* ignore quota / private mode */
    }
  }

  function removeStoredState() {
    if (!storageKey) return;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }

  function restoreFromStorage() {
    if (!storageKey) return false;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data?.request?.url?.trim()) return false;
      isRestoring = true;
      populate(data.request);
      if (data.activeTab && data.activeTab !== activeTab) {
        switchTab(data.activeTab, { skipPersist: true });
      }
      isRestoring = false;
      const req = buildRequest();
      if (onChange) onChange(req);
      return true;
    } catch {
      isRestoring = false;
      return false;
    }
  }

  const methodSelect = document.getElementById('preview-method');
  const urlInput = document.getElementById('preview-url');
  const bodyInput = document.getElementById('preview-body-input');
  const paramsTbody = document.getElementById('preview-params-tbody');
  const headersTbody = document.getElementById('preview-headers-tbody');
  const headersTabBtn = document.getElementById('preview-tab-headers');
  const paramsTabBtn = document.getElementById('preview-tab-params');
  const formDataTbody = document.getElementById('preview-formdata-tbody');
  const urlencodedTbody = document.getElementById('preview-urlencoded-tbody');
  const rawTypeSelect = document.getElementById('preview-raw-type');
  const binaryFileInput = document.getElementById('preview-binary-file');
  const binaryNameEl = document.getElementById('preview-binary-name');
  const graphqlQueryInput = document.getElementById('preview-graphql-query');
  const graphqlVarsInput = document.getElementById('preview-graphql-vars');

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function emptyKvRow() {
    return { key: '', value: '', enabled: true };
  }

  function parseParamsFromUrl(url) {
    const rows = [];
    try {
      const u = new URL(url);
      u.searchParams.forEach((value, key) => rows.push({ key, value, enabled: true }));
    } catch { /* ignore */ }
    rows.push(emptyKvRow());
    return rows;
  }

  function parseHeadersFromObject(headers) {
    const rows = Object.entries(headers || {}).map(([key, value]) => ({
      key, value, enabled: true,
    }));
    rows.push(emptyKvRow());
    return rows;
  }

  function parseUrlencodedBody(text) {
    const rows = [];
    try {
      const params = new URLSearchParams(text);
      params.forEach((value, key) => rows.push({ key, value, enabled: true }));
    } catch { /* ignore */ }
    rows.push(emptyKvRow());
    return rows;
  }

  function decodeCurlEscapes(str) {
    return String(str)
      .replace(/\\r/g, '\r')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

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

  function parseMultipartBody(text, contentType) {
    const rows = [];
    const normalized = normalizeBodyText(text);
    if (!normalized) return rows;

    let boundary = null;
    const ctMatch = (contentType || '').match(/boundary=([^;\s]+)/i);
    if (ctMatch) boundary = ctMatch[1].replace(/^["']|["']$/g, '');
    if (!boundary) {
      const startMatch = normalized.match(/^--([^\r\n]+)/);
      boundary = startMatch?.[1];
    }
    if (!boundary) return rows;

    normalized.split(`--${boundary}`).forEach(segment => {
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

    if (rows.length) rows.push(emptyKvRow());
    return rows;
  }

  function ensureTrailingEmptyRow(rows) {
    const last = rows[rows.length - 1];
    if (!last || last.key || last.value) rows.push(emptyKvRow());
  }

  function getContentType(headers) {
    const entry = Object.entries(headers || {}).find(([k]) => k.toLowerCase() === 'content-type');
    return entry ? entry[1] : '';
  }

  function setBodyType(type) {
    bodyType = BODY_TYPES.includes(type) ? type : 'none';
    document.querySelectorAll('input[name="body-type"]').forEach(radio => {
      radio.checked = radio.value === bodyType;
    });
    BODY_TYPES.forEach(t => {
      const panel = document.getElementById(`body-panel-${t}`);
      if (panel) panel.hidden = t !== bodyType;
    });
  }

  function updateHeaderTabCount() {
    const count = headerRows.filter(h => h.enabled && h.key).length;
    headersTabBtn.textContent = count ? `Headers (${count})` : 'Headers';
  }

  function updateParamsTabCount() {
    if (!paramsTabBtn) return;
    const count = paramRows.filter(p => p.enabled && p.key).length;
    paramsTabBtn.textContent = count ? `Params (${count})` : 'Params';
    paramsTabBtn.classList.toggle('has-values', count > 0);
  }

  function normalizeUrlString(url) {
    const text = (url || '').trim();
    if (!text) return text;
    if (/^https?:\/\//i.test(text)) return text;
    return `http://${text}`;
  }

  function getUrlWithoutQuery(url) {
    try {
      const u = new URL(normalizeUrlString(url));
      u.search = '';
      u.hash = '';
      return u.toString();
    } catch {
      const noHash = (url || '').split('#')[0];
      const idx = noHash.indexOf('?');
      return idx >= 0 ? noHash.slice(0, idx) : noHash;
    }
  }

  function switchTab(tab, options = {}) {
    activeTab = tab;
    document.querySelectorAll('.preview-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.previewTab === tab);
    });
    document.querySelectorAll('.preview-panel').forEach(panel => {
      panel.hidden = panel.dataset.previewPanel !== tab;
    });
    if (!options.skipPersist) schedulePersist();
  }

  function applyParamsToUrl() {
    const raw = urlInput.value;
    const base = getUrlWithoutQuery(raw) || raw.trim();
    const url = buildUrlWithParams(base, paramRows);

    if (url !== raw && urlInput !== document.activeElement) {
      urlSyncLock = true;
      urlInput.value = url;
      urlSyncLock = false;
    }

    const req = buildRequest();
    if (onChange) onChange(req);
    schedulePersist();
    return req;
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => applyParamsToUrl(), 200);
  }

  function syncNow() {
    clearTimeout(syncTimer);
    applyParamsToUrl();
  }

  function applyUrlToParams() {
    if (urlSyncLock) return;
    paramRows = parseParamsFromUrl(urlInput.value);
    renderParamRows();
    updateParamsTabCount();
  }

  function buildUrlWithParams(baseUrl, rows) {
    try {
      const u = new URL(normalizeUrlString(baseUrl));
      const params = new URLSearchParams();
      rows.forEach(row => {
        if (row.enabled && row.key) params.append(row.key, row.value);
      });
      u.search = params.toString();
      return u.toString();
    } catch {
      return baseUrl;
    }
  }

  function buildMultipartBody(rows) {
    const boundary = `----HuTu${Date.now().toString(16)}`;
    const parts = [];
    rows.filter(r => r.enabled && r.key).forEach(row => {
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="${row.key}"\r\n\r\n${row.value}\r\n`
      );
    });
    parts.push(`--${boundary}--\r\n`);
    return { body: parts.join(''), contentType: `multipart/form-data; boundary=${boundary}` };
  }

  function buildUrlencodedBody(rows) {
    const params = new URLSearchParams();
    rows.filter(r => r.enabled && r.key).forEach(r => params.append(r.key, r.value));
    return { body: params.toString(), contentType: 'application/x-www-form-urlencoded' };
  }

  function applyHeaderUpdate(headers, name, value) {
    const existing = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
    if (existing) headers[existing] = value;
    else headers[name] = value;
  }

  function removeHeader(headers, name) {
    const existing = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
    if (existing) delete headers[existing];
  }

  function buildBodyPayload() {
    switch (bodyType) {
      case 'form-data': {
        const { body, contentType } = buildMultipartBody(formDataRows);
        return { body: body || null, body_encoding: 'utf-8', contentType: body ? contentType : null };
      }
      case 'urlencoded': {
        const { body, contentType } = buildUrlencodedBody(urlencodedRows);
        return { body: body || null, body_encoding: 'utf-8', contentType: body ? contentType : null };
      }
      case 'raw': {
        const text = bodyInput.value;
        const ct = RAW_CONTENT_TYPES[rawSubtype] || 'text/plain';
        return { body: text || null, body_encoding: 'utf-8', contentType: text ? ct : null };
      }
      case 'binary': {
        return {
          body: binaryBase64 || null,
          body_encoding: 'base64',
          contentType: binaryBase64 ? 'application/octet-stream' : null,
        };
      }
      case 'graphql': {
        let variables = {};
        const varsText = graphqlVarsInput.value.trim();
        if (varsText) {
          try { variables = JSON.parse(varsText); } catch { variables = {}; }
        }
        const payload = JSON.stringify({ query: graphqlQueryInput.value, variables });
        const hasContent = graphqlQueryInput.value.trim();
        return {
          body: hasContent ? payload : null,
          body_encoding: 'utf-8',
          contentType: hasContent ? 'application/json' : null,
        };
      }
      default:
        return { body: null, body_encoding: 'utf-8', contentType: null };
    }
  }

  function buildRequest() {
    const method = methodSelect.value || 'GET';
    const base = getUrlWithoutQuery(urlInput.value) || urlInput.value.trim();
    const url = buildUrlWithParams(base, paramRows);
    const headers = {};
    headerRows.forEach(row => {
      if (row.enabled && row.key) headers[row.key] = row.value;
    });

    const bodyPayload = buildBodyPayload();
    if (bodyPayload.contentType) {
      applyHeaderUpdate(headers, 'Content-Type', bodyPayload.contentType);
    } else if (bodyType === 'none') {
      removeHeader(headers, 'Content-Type');
    }

    return {
      url,
      method,
      headers,
      body: bodyPayload.body,
      body_encoding: bodyPayload.body_encoding,
      bodyMeta: getBodyMetaSnapshot(),
    };
  }

  function getBodyMetaSnapshot() {
    return {
      type: bodyType,
      rawSubtype,
      formRows: bodyType === 'form-data' ? formDataRows.filter(r => r.key || r.value) : [],
      urlencodedRows: bodyType === 'urlencoded' ? urlencodedRows.filter(r => r.key || r.value) : [],
      rawText: bodyType === 'raw' ? bodyInput.value : '',
      binaryBase64: bodyType === 'binary' ? binaryBase64 : '',
      binaryFilename: bodyType === 'binary' ? binaryFilename : '',
      graphqlQuery: bodyType === 'graphql' ? graphqlQueryInput.value : '',
      graphqlVariables: bodyType === 'graphql' ? graphqlVarsInput.value : '',
    };
  }

  function renderKvTable(tbody, rows, prefix) {
    ensureTrailingEmptyRow(rows);
    tbody.innerHTML = rows.map((row, idx) => `
      <tr>
        <td class="preview-check-col">
          <input type="checkbox" data-${prefix}-idx="${idx}" data-field="enabled" ${row.enabled ? 'checked' : ''}>
        </td>
        <td>
          <input type="text" class="preview-cell-input" data-${prefix}-idx="${idx}" data-field="key"
                 value="${escapeHtml(row.key)}" placeholder="Key" spellcheck="false">
        </td>
        <td>
          <input type="text" class="preview-cell-input" data-${prefix}-idx="${idx}" data-field="value"
                 value="${escapeHtml(row.value)}" placeholder="Value" spellcheck="false">
        </td>
      </tr>
    `).join('');
  }

  function renderParamRows() { renderKvTable(paramsTbody, paramRows, 'param'); }
  function renderHeaderRows() { renderKvTable(headersTbody, headerRows, 'header'); updateHeaderTabCount(); }
  function renderFormDataRows() { renderKvTable(formDataTbody, formDataRows, 'formdata'); }
  function renderUrlencodedRows() { renderKvTable(urlencodedTbody, urlencodedRows, 'urlencoded'); }

  function updateKvField(rows, renderFn, idx, field, value, prefix) {
    const row = rows[idx];
    if (!row) return;
    if (field === 'enabled') row.enabled = value;
    else row[field] = value;
    if (field === 'key' || field === 'value') {
      const lenBefore = rows.length;
      ensureTrailingEmptyRow(rows);
      if (rows.length > lenBefore) renderFn();
    }
    if (prefix === 'param') {
      updateParamsTabCount();
      syncNow();
    } else if (prefix === 'header') {
      updateHeaderTabCount();
      scheduleSync();
    } else {
      scheduleSync();
    }
  }

  function applyBodyMeta(meta, body) {
    setBodyType(meta.type || 'none');
    rawSubtype = meta.rawSubtype || 'json';
    if (rawTypeSelect) rawTypeSelect.value = rawSubtype;

    if (meta.type === 'form-data') {
      formDataRows = (meta.formRows || []).map(r => ({ ...r }));
      ensureTrailingEmptyRow(formDataRows);
      renderFormDataRows();
    } else if (meta.type === 'urlencoded') {
      urlencodedRows = (meta.urlencodedRows || []).map(r => ({ ...r }));
      ensureTrailingEmptyRow(urlencodedRows);
      renderUrlencodedRows();
    } else if (meta.type === 'raw') {
      bodyInput.value = body || meta.rawText || '';
    } else if (meta.type === 'binary') {
      binaryBase64 = meta.binaryBase64 || '';
      binaryFilename = meta.binaryFilename || '';
      if (binaryNameEl) binaryNameEl.textContent = binaryFilename || '未选择文件';
    } else if (meta.type === 'graphql') {
      graphqlQueryInput.value = meta.graphqlQuery || '';
      graphqlVarsInput.value = meta.graphqlVariables || '{}';
    }
  }

  function inferBodyFromRequest(request) {
    const headers = request.headers || {};
    const body = request.body;
    const ct = getContentType(headers);

    if (request.bodyMeta?.type) {
      applyBodyMeta(request.bodyMeta, body);
      return;
    }

    if (!body) {
      setBodyType('none');
      return;
    }

    const normalizedBody = normalizeBodyText(body);

    if (ct.includes('multipart/form-data') || normalizedBody.includes('Content-Disposition: form-data')) {
      const parsed = parseMultipartBody(normalizedBody, ct);
      if (parsed.length) {
        setBodyType('form-data');
        formDataRows = parsed;
        renderFormDataRows();
        return;
      }
    }

    if (ct.includes('application/x-www-form-urlencoded')) {
      setBodyType('urlencoded');
      urlencodedRows = parseUrlencodedBody(normalizedBody);
      renderUrlencodedRows();
      return;
    }

    if (ct.includes('application/graphql') || (normalizedBody.includes('query') && normalizedBody.trim().startsWith('{'))) {
      try {
        const parsed = JSON.parse(normalizedBody);
        if (parsed.query) {
          setBodyType('graphql');
          graphqlQueryInput.value = parsed.query;
          graphqlVarsInput.value = JSON.stringify(parsed.variables || {}, null, 2);
          return;
        }
      } catch { /* fall through */ }
    }

    setBodyType('raw');
    bodyInput.value = normalizedBody;
    if (ct.includes('json')) rawSubtype = 'json';
    else if (ct.includes('javascript')) rawSubtype = 'javascript';
    else if (ct.includes('html')) rawSubtype = 'html';
    else if (ct.includes('xml')) rawSubtype = 'xml';
    else if (normalizedBody.trim().startsWith('{') || normalizedBody.trim().startsWith('[')) rawSubtype = 'json';
    else rawSubtype = 'text';
    if (rawTypeSelect) rawTypeSelect.value = rawSubtype;
  }

  function populate(request) {
    if (!request) {
      clear();
      return;
    }
    methodSelect.value = request.method || 'GET';
    urlInput.value = request.url || '';
    paramRows = parseParamsFromUrl(request.url || '');
    headerRows = parseHeadersFromObject(request.headers);
    inferBodyFromRequest(request);
    renderParamRows();
    renderHeaderRows();
    updateHeaderTabCount();
    updateParamsTabCount();
    urlSyncLock = true;
    urlInput.value = buildUrlWithParams(
      getUrlWithoutQuery(request.url || '') || request.url || '',
      paramRows,
    );
    urlSyncLock = false;
    if (!isRestoring) schedulePersist();
  }

  function clear() {
    methodSelect.value = 'GET';
    urlInput.value = '';
    paramRows = [emptyKvRow()];
    headerRows = [emptyKvRow()];
    formDataRows = [emptyKvRow()];
    urlencodedRows = [emptyKvRow()];
    bodyInput.value = '';
    rawSubtype = 'json';
    if (rawTypeSelect) rawTypeSelect.value = 'json';
    binaryBase64 = '';
    binaryFilename = '';
    if (binaryFileInput) binaryFileInput.value = '';
    if (binaryNameEl) binaryNameEl.textContent = '未选择文件';
    graphqlQueryInput.value = '';
    graphqlVarsInput.value = '';
    setBodyType('none');
    renderParamRows();
    renderHeaderRows();
    renderFormDataRows();
    renderUrlencodedRows();
    updateHeaderTabCount();
    updateParamsTabCount();
    removeStoredState();
  }

  function setUrlBar(text) {
    urlInput.value = text || '';
    if (text) {
      paramRows = parseParamsFromUrl(text);
      renderParamRows();
      updateParamsTabCount();
    }
  }

  function getRowsByPrefix(prefix) {
    switch (prefix) {
      case 'param': return paramRows;
      case 'header': return headerRows;
      case 'formdata': return formDataRows;
      case 'urlencoded': return urlencodedRows;
      default: return [];
    }
  }

  function bindKvTable(tbody, renderFn, prefix) {
    tbody.addEventListener('change', (e) => {
      const target = e.target;
      const idxKey = `${prefix}Idx`;
      if (target.dataset[idxKey] == null) return;
      const rows = getRowsByPrefix(prefix);
      if (target.dataset.field === 'enabled') {
        updateKvField(rows, renderFn, +target.dataset[idxKey], 'enabled', target.checked, prefix);
      }
    });
    tbody.addEventListener('input', (e) => {
      const target = e.target;
      const idxKey = `${prefix}Idx`;
      if (target.dataset[idxKey] == null) return;
      const rows = getRowsByPrefix(prefix);
      updateKvField(rows, renderFn, +target.dataset[idxKey], target.dataset.field, target.value, prefix);
    });
  }

  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  async function copyCurl(btn) {
    const request = buildRequest();
    if (!request?.url?.trim()) return false;
    if (typeof CurlConvert === 'undefined') return false;

    const curl = CurlConvert.buildCurlFromRequest(request);
    const orig = btn?.textContent || '复制 curl';
    try {
      await navigator.clipboard.writeText(curl);
      if (btn) btn.textContent = '已复制';
    } catch {
      if (btn) btn.textContent = '已复制';
    }
    if (btn) setTimeout(() => { btn.textContent = orig; }, 1500);
    return true;
  }

  function setupCopyCurlButton() {
    const header = document.querySelector('.preview-section-header');
    if (!header || document.getElementById('copy-preview-curl')) return;

    let actions = header.querySelector('.preview-section-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'preview-section-actions';
      header.appendChild(actions);
    }

    const shareBtn = document.getElementById('share-request');
    const clearBtn = document.getElementById('clear-preview');
    if (shareBtn && shareBtn.parentElement !== actions) {
      actions.appendChild(shareBtn);
    }
    if (clearBtn && clearBtn.parentElement !== actions) {
      actions.appendChild(clearBtn);
    }

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn-link';
    copyBtn.id = 'copy-preview-curl';
    copyBtn.textContent = '复制 curl';
    copyBtn.title = '复制当前请求为 curl 命令';
    copyBtn.addEventListener('click', () => copyCurl(copyBtn));
    actions.appendChild(copyBtn);
  }

  function init(options) {
    onChange = options.onChange;
    const onPasteCurl = options.onPasteCurl;
    storageKey = resolveStorageKey(options);
    persistEnabled = options.persist !== false;

    function isCurlLike(text) {
      const t = text.trim();
      if (!t) return false;
      const lower = t.toLowerCase();
      return lower.startsWith('curl') || (lower.includes('-h ') && /https?:\/\//.test(t));
    }

    function tryConvertCurl(text) {
      if (onPasteCurl && isCurlLike(text)) {
        onPasteCurl(text.trim());
        return true;
      }
      return false;
    }

    methodSelect.innerHTML = METHODS.map(m => `<option value="${m}">${m}</option>`).join('');

    document.querySelectorAll('.preview-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.previewTab));
    });

    document.querySelectorAll('input[name="body-type"]').forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          setBodyType(radio.value);
          syncNow();
        }
      });
    });

    methodSelect.addEventListener('change', syncNow);

    urlInput.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text') || '';
      if (tryConvertCurl(text)) e.preventDefault();
    });

    urlInput.addEventListener('input', () => {
      if (urlSyncLock) return;
      clearTimeout(urlInputTimer);
      urlInputTimer = setTimeout(applyUrlToParams, 200);
    });

    urlInput.addEventListener('change', () => {
      const v = urlInput.value.trim();
      if (tryConvertCurl(v)) return;
      applyUrlToParams();
      applyParamsToUrl();
    });

    urlInput.addEventListener('blur', () => {
      if (urlSyncLock) return;
      applyUrlToParams();
      applyParamsToUrl();
    });

    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('send-btn').click();
    });

    bodyInput.addEventListener('input', scheduleSync);
    if (rawTypeSelect) {
      rawTypeSelect.addEventListener('change', () => {
        rawSubtype = rawTypeSelect.value;
        syncNow();
      });
    }
    graphqlQueryInput.addEventListener('input', scheduleSync);
    graphqlVarsInput.addEventListener('input', scheduleSync);

    if (binaryFileInput) {
      binaryFileInput.addEventListener('change', () => {
        const file = binaryFileInput.files[0];
        if (!file) {
          binaryBase64 = '';
          binaryFilename = '';
          if (binaryNameEl) binaryNameEl.textContent = '未选择文件';
          scheduleSync();
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          binaryBase64 = arrayBufferToBase64(reader.result);
          binaryFilename = file.name;
          if (binaryNameEl) binaryNameEl.textContent = file.name;
          syncNow();
        };
        reader.readAsArrayBuffer(file);
      });
    }

    bindKvTable(paramsTbody, renderParamRows, 'param');
    bindKvTable(headersTbody, renderHeaderRows, 'header');
    bindKvTable(formDataTbody, renderFormDataRows, 'formdata');
    bindKvTable(urlencodedTbody, renderUrlencodedRows, 'urlencoded');

    setupCopyCurlButton();

    switchTab('params', { skipPersist: true });
    setBodyType('none');
    renderFormDataRows();
    renderUrlencodedRows();
  }

  return {
    init,
    populate,
    clear,
    buildRequest,
    setUrlBar,
    copyCurl,
    restoreFromStorage,
    removeStoredState,
  };
})();

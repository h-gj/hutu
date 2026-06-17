/** Postman-style editable request preview (params / headers / body). */
const RequestPreview = (() => {
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

  let onChange = null;
  let activeTab = 'params';
  let paramRows = [];
  let headerRows = [];
  let syncTimer = null;

  const section = document.getElementById('request-preview-section');
  const methodSelect = document.getElementById('preview-method');
  const urlInput = document.getElementById('preview-url');
  const bodyInput = document.getElementById('preview-body-input');
  const paramsTbody = document.getElementById('preview-params-tbody');
  const headersTbody = document.getElementById('preview-headers-tbody');
  const headersTabBtn = document.getElementById('preview-tab-headers');

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function emptyParamRow() {
    return { key: '', value: '', enabled: true };
  }

  function emptyHeaderRow() {
    return { key: '', value: '', enabled: true };
  }

  function parseParamsFromUrl(url) {
    const rows = [];
    try {
      const u = new URL(url);
      u.searchParams.forEach((value, key) => {
        rows.push({ key, value, enabled: true });
      });
    } catch {
      /* ignore */
    }
    rows.push(emptyParamRow());
    return rows;
  }

  function parseHeadersFromObject(headers) {
    const rows = Object.entries(headers || {}).map(([key, value]) => ({
      key,
      value,
      enabled: true,
    }));
    rows.push(emptyHeaderRow());
    return rows;
  }

  function ensureTrailingEmptyRow(rows, emptyFactory) {
    const last = rows[rows.length - 1];
    if (!last || last.key || last.value) {
      rows.push(emptyFactory());
    }
  }

  function updateHeaderTabCount() {
    const count = headerRows.filter(h => h.enabled && h.key).length;
    headersTabBtn.textContent = count ? `Headers (${count})` : 'Headers';
  }

  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.preview-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.previewTab === tab);
    });
    document.querySelectorAll('.preview-panel').forEach(panel => {
      panel.hidden = panel.dataset.previewPanel !== tab;
    });
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      const req = buildRequest();
      urlInput.value = req.url;
      if (onChange) onChange(req);
    }, 200);
  }

  function syncNow() {
    clearTimeout(syncTimer);
    const req = buildRequest();
    urlInput.value = req.url;
    if (onChange) onChange(req);
  }

  function buildUrlWithParams(baseUrl, rows) {
    try {
      const u = new URL(baseUrl);
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

  function buildRequest() {
    const method = methodSelect.value || 'GET';
    const url = buildUrlWithParams(urlInput.value, paramRows);
    const headers = {};
    headerRows.forEach(row => {
      if (row.enabled && row.key) headers[row.key] = row.value;
    });
    const bodyText = bodyInput.value;
    const body = bodyText ? bodyText : null;
    return { url, method, headers, body };
  }

  function renderParamRows() {
    ensureTrailingEmptyRow(paramRows, emptyParamRow);
    paramsTbody.innerHTML = paramRows.map((row, idx) => `
      <tr>
        <td class="preview-check-col">
          <input type="checkbox" data-param-idx="${idx}" data-field="enabled" ${row.enabled ? 'checked' : ''}>
        </td>
        <td>
          <input type="text" class="preview-cell-input" data-param-idx="${idx}" data-field="key"
                 value="${escapeHtml(row.key)}" placeholder="Key" spellcheck="false">
        </td>
        <td>
          <input type="text" class="preview-cell-input" data-param-idx="${idx}" data-field="value"
                 value="${escapeHtml(row.value)}" placeholder="Value" spellcheck="false">
        </td>
      </tr>
    `).join('');
  }

  function renderHeaderRows() {
    ensureTrailingEmptyRow(headerRows, emptyHeaderRow);
    headersTbody.innerHTML = headerRows.map((row, idx) => `
      <tr>
        <td class="preview-check-col">
          <input type="checkbox" data-header-idx="${idx}" data-field="enabled" ${row.enabled ? 'checked' : ''}>
        </td>
        <td>
          <input type="text" class="preview-cell-input" data-header-idx="${idx}" data-field="key"
                 value="${escapeHtml(row.key)}" placeholder="Key" spellcheck="false">
        </td>
        <td>
          <input type="text" class="preview-cell-input" data-header-idx="${idx}" data-field="value"
                 value="${escapeHtml(row.value)}" placeholder="Value" spellcheck="false">
        </td>
      </tr>
    `).join('');
    updateHeaderTabCount();
  }

  function updateParamField(idx, field, value) {
    const row = paramRows[idx];
    if (!row) return;
    if (field === 'enabled') row.enabled = value;
    else row[field] = value;
    if (field === 'key' || field === 'value') {
      ensureTrailingEmptyRow(paramRows, emptyParamRow);
      if (idx === paramRows.length - 2 && (row.key || row.value)) {
        renderParamRows();
      }
    }
    scheduleSync();
  }

  function updateHeaderField(idx, field, value) {
    const row = headerRows[idx];
    if (!row) return;
    if (field === 'enabled') row.enabled = value;
    else row[field] = value;
    if (field === 'key' || field === 'value') {
      ensureTrailingEmptyRow(headerRows, emptyHeaderRow);
      if (idx === headerRows.length - 2 && (row.key || row.value)) {
        renderHeaderRows();
      }
    }
    updateHeaderTabCount();
    scheduleSync();
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
    bodyInput.value = request.body || '';
    renderParamRows();
    renderHeaderRows();
    updateHeaderTabCount();
  }

  function clear() {
    methodSelect.value = 'GET';
    urlInput.value = '';
    paramRows = [emptyParamRow()];
    headerRows = [emptyHeaderRow()];
    bodyInput.value = '';
    renderParamRows();
    renderHeaderRows();
    updateHeaderTabCount();
  }

  function setUrlBar(text) {
    urlInput.value = text || '';
  }

  function init(options) {
    onChange = options.onChange;
    const onPasteCurl = options.onPasteCurl;

    function tryConvertCurl(text) {
      if (onPasteCurl && isCurlLike(text)) {
        onPasteCurl(text.trim());
        return true;
      }
      return false;
    }

    function isCurlLike(text) {
      const t = text.trim();
      if (!t) return false;
      const lower = t.toLowerCase();
      return lower.startsWith('curl') || (lower.includes('-h ') && /https?:\/\//.test(t));
    }

    methodSelect.innerHTML = METHODS.map(m =>
      `<option value="${m}">${m}</option>`
    ).join('');

    document.querySelectorAll('.preview-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.previewTab));
    });

    methodSelect.addEventListener('change', syncNow);

    urlInput.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text') || '';
      if (tryConvertCurl(text)) {
        e.preventDefault();
      }
    });

    urlInput.addEventListener('change', () => {
      const v = urlInput.value.trim();
      if (tryConvertCurl(v)) return;
      paramRows = parseParamsFromUrl(urlInput.value);
      renderParamRows();
      syncNow();
    });

    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('send-btn').click();
      }
    });

    bodyInput.addEventListener('input', scheduleSync);

    paramsTbody.addEventListener('change', (e) => {
      const target = e.target;
      if (target.dataset.paramIdx == null) return;
      const idx = +target.dataset.paramIdx;
      const field = target.dataset.field;
      if (field === 'enabled') {
        updateParamField(idx, field, target.checked);
      }
    });

    paramsTbody.addEventListener('input', (e) => {
      const target = e.target;
      if (target.dataset.paramIdx == null) return;
      updateParamField(+target.dataset.paramIdx, target.dataset.field, target.value);
    });

    headersTbody.addEventListener('change', (e) => {
      const target = e.target;
      if (target.dataset.headerIdx == null) return;
      const idx = +target.dataset.headerIdx;
      const field = target.dataset.field;
      if (field === 'enabled') {
        updateHeaderField(idx, field, target.checked);
      }
    });

    headersTbody.addEventListener('input', (e) => {
      const target = e.target;
      if (target.dataset.headerIdx == null) return;
      updateHeaderField(+target.dataset.headerIdx, target.dataset.field, target.value);
    });

    switchTab('params');
  }

  return { init, populate, clear, buildRequest, setUrlBar };
})();

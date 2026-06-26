(() => {
  const API_BASE = 'https://v8api.k0v.cn/api/common';

  const cacheKeyInput = document.getElementById('cache-key');
  const checkCacheBtn = document.getElementById('check-cache-btn');
  const clearCacheBtn = document.getElementById('clear-cache-btn');
  const errorEl = document.getElementById('error');
  const statusBadge = document.getElementById('status-badge');
  const responseMeta = document.getElementById('response-meta');
  const responseViewer = ResponseViewer.create(document.getElementById('response-viewer'));

  let loading = false;

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function hideError() {
    errorEl.hidden = true;
  }

  function setLoading(active) {
    loading = active;
    checkCacheBtn.disabled = active;
    clearCacheBtn.disabled = active;
    if (active) {
      statusBadge.innerHTML =
        '<span class="status-spinner" aria-hidden="true"></span><span>请求中...</span>';
      statusBadge.className = 'status-badge loading';
      statusBadge.hidden = false;
    }
  }

  function setBadge(status, elapsedMs) {
    if (!status) {
      statusBadge.hidden = true;
      return;
    }
    const ok = status >= 200 && status < 300;
    statusBadge.textContent = String(status);
    statusBadge.className = `status-badge ${ok ? 'ok' : 'err'}`;
    statusBadge.hidden = false;
    responseMeta.textContent = elapsedMs != null ? `${elapsedMs} ms` : '';
  }

  function getCacheKey() {
    return cacheKeyInput.value.trim();
  }

  function buildUrl(action, key) {
    return `${API_BASE}/${action}/?key=${encodeURIComponent(key)}`;
  }

  async function sendRequest(url) {
    const res = await fetch('/api/request-local/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request: {
          url,
          method: 'GET',
          headers: { accept: 'application/json, text/plain, */*' },
        },
      }),
    });
    return res.json();
  }

  function displayResult(data) {
    if (!data.ok) {
      setBadge(data.status || null, data.elapsed_ms);
      responseViewer.setText(data.error || data.body || '请求失败');
      showError(data.error || '请求失败');
      return;
    }

    setBadge(data.status, data.elapsed_ms);
    hideError();
    responseViewer.setText(data.body || '');
  }

  async function runAction(action, label) {
    const key = getCacheKey();
    if (!key) {
      showError('请输入缓存 key');
      cacheKeyInput.focus();
      return;
    }

    if (action === 'clear_cache') {
      const ok = confirm(`确定删除缓存「${key}」？`);
      if (!ok) return;
    }

    setLoading(true);
    responseViewer.clear();
    responseMeta.textContent = '';
    hideError();

    try {
      const url = buildUrl(action, key);
      const data = await sendRequest(url);
      displayResult(data);
    } catch (err) {
      setBadge(null);
      responseViewer.setText(err.message || String(err));
      showError(`${label}失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  checkCacheBtn.addEventListener('click', () => runAction('check_cache', '查询'));
  clearCacheBtn.addEventListener('click', () => runAction('clear_cache', '删除'));

  cacheKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runAction('check_cache', '查询');
    }
  });
})();

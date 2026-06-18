(() => {
  const SLUG_RE = /^[a-z0-9]{3,32}$/;
  const SAVE_DEBOUNCE_MS = 600;

  const slug = location.pathname.replace(/^\//, '').toLowerCase();
  if (!SLUG_RE.test(slug)) {
    location.replace('/tools/online-editor/');
    return;
  }

  const textarea = document.getElementById('note-content');
  const saveStatus = document.getElementById('save-status');
  const pathEl = document.getElementById('note-path');
  const apiUrl = `/api/notes/${encodeURIComponent(slug)}`;

  pathEl.textContent = `/${slug}`;

  let isLoading = false;
  let lastSavedContent = '';
  let saveTimer = null;
  let saving = false;
  let saveQueued = false;

  function setStatus(text) {
    saveStatus.textContent = text;
  }

  function isDirty() {
    return textarea.value !== lastSavedContent;
  }

  async function loadNote() {
    isLoading = true;
    setStatus('加载中…');
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '加载失败');
      textarea.value = data.content || '';
      lastSavedContent = textarea.value;
      setStatus('');
    } catch (err) {
      setStatus(`加载失败: ${err.message}`);
    } finally {
      isLoading = false;
    }
  }

  async function persistNote() {
    if (isLoading) return;

    const content = textarea.value;
    if (content === lastSavedContent) {
      if (!saving) setStatus('已保存');
      return;
    }

    if (saving) {
      saveQueued = true;
      return;
    }

    saving = true;
    setStatus('保存中…');

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '保存失败');

      lastSavedContent = content;
      setStatus('已保存');
    } catch (err) {
      setStatus(`保存失败: ${err.message}`);
      console.error('note save error:', err);
    } finally {
      saving = false;
      if (saveQueued || isDirty()) {
        saveQueued = false;
        persistNote();
      }
    }
  }

  function schedulePersist() {
    if (isLoading) return;
    clearTimeout(saveTimer);
    setStatus('编辑中…');
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistNote();
    }, SAVE_DEBOUNCE_MS);
  }

  textarea.addEventListener('input', schedulePersist);

  textarea.addEventListener('blur', () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (isDirty()) persistNote();
  });

  document.getElementById('copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setStatus('链接已复制');
      setTimeout(() => {
        if (saveStatus.textContent === '链接已复制') {
          setStatus(isDirty() ? '编辑中…' : '已保存');
        }
      }, 1500);
    } catch {
      setStatus('复制失败');
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (isDirty() || saving || saveTimer) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  loadNote();
})();

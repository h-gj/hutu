/** Shared online doc storage for Markdown / JSON viewer share links. */
const DocShare = (() => {
  const DOC_ID_RE = /^[a-z0-9]{10,16}$/;
  const API = '/api/markdown-doc';

  function parseIdFromUrl() {
    const id = new URLSearchParams(window.location.search).get('id');
    return id && DOC_ID_RE.test(id) ? id : null;
  }

  function buildPageUrl(id) {
    const url = new URL(window.location.href);
    url.search = `?id=${encodeURIComponent(id)}`;
    return url.toString();
  }

  function setPageUrl(id) {
    history.replaceState(null, '', buildPageUrl(id));
  }

  function clearPageUrl() {
    const url = new URL(window.location.href);
    url.search = '';
    history.replaceState(null, '', url.toString());
  }

  async function create(content) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '创建失败');
    return data.id;
  }

  async function load(id) {
    const res = await fetch(`${API}/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '加载失败');
    return data.content || '';
  }

  async function save(id, content) {
    const res = await fetch(`${API}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '保存失败');
    return data;
  }

  return {
    parseIdFromUrl,
    buildPageUrl,
    setPageUrl,
    clearPageUrl,
    create,
    load,
    save,
    DOC_ID_RE,
  };
})();

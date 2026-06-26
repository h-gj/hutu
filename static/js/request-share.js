/** Online share storage for request tool snapshots (Request Local / Postbuman). */
const RequestShare = (() => {
  const DOC_ID_RE = /^[a-z0-9]{10,16}$/;

  function forApi(api) {
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
      const res = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '创建失败');
      return data.id;
    }

    async function load(id) {
      const res = await fetch(`${api}/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '加载失败');
      return data.content || {};
    }

    async function save(id, content) {
      const res = await fetch(`${api}/${encodeURIComponent(id)}`, {
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
  }

  const script = document.currentScript;
  const defaultApi = script?.dataset?.api || '/api/request-local/share';

  return Object.assign(forApi(defaultApi), { forApi, DOC_ID_RE });
})();

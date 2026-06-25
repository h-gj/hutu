/** Wrap a textarea with a synced line-number gutter. */
const LineEditor = (() => {
  function init(textarea, options = {}) {
    if (!textarea || textarea.dataset.lineEditor) return null;

    const dark = options.dark === true;
    const wrap = document.createElement('div');
    wrap.className = dark ? 'line-editor line-editor-dark' : 'line-editor';

    const gutter = document.createElement('div');
    gutter.className = 'line-editor-gutter';
    gutter.setAttribute('aria-hidden', 'true');

    const linesEl = document.createElement('div');
    linesEl.className = 'line-editor-lines';
    gutter.appendChild(linesEl);

    const parent = textarea.parentNode;
    parent.insertBefore(wrap, textarea);
    wrap.appendChild(gutter);
    wrap.appendChild(textarea);

    textarea.classList.add('line-editor-input');
    textarea.dataset.lineEditor = '1';

    function updateLines() {
      const lineCount = textarea.value.split('\n').length || 1;
      linesEl.textContent = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
    }

    function syncScroll() {
      gutter.scrollTop = textarea.scrollTop;
    }

    textarea.addEventListener('input', updateLines);
    textarea.addEventListener('scroll', syncScroll);
    updateLines();

    return { updateLines };
  }

  return { init };
})();

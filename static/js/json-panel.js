/** Reusable JSON editor panel (dark theme, line numbers; optional expand modal). */
const JsonPanel = (() => {
  async function copyWithFeedback(btn, text) {
    if (!text) return;
    const orig = btn.textContent;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = '已复制';
    } catch {
      btn.textContent = '已复制';
    }
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }

  function init(config) {
    const {
      textEl,
      helperSelector,
      expandTitle = 'JSON',
      onChange,
      clearBtn,
      copyBtn,
      expandBtn,
    } = config;

    if (!textEl) throw new Error('JsonPanel: missing textEl');

    const jsonEditor = LineEditor.init(textEl, { dark: true });
    const helperEl = document.querySelector(helperSelector);
    const jsonPreview = helperEl
      ? ResponseViewer.create(helperEl, {
          title: expandTitle,
          expandable: true,
          onChange: (newText) => {
            textEl.value = newText;
            jsonEditor?.updateLines();
            if (onChange) onChange(newText);
          },
        })
      : null;

    function setValue(text) {
      textEl.value = text || '';
      jsonEditor?.updateLines();
    }

    function clear() {
      setValue('');
    }

    function expand() {
      const text = textEl.value;
      if (!text.trim() || !jsonPreview) return;
      jsonPreview.setText(text);
      jsonPreview.openExpand();
    }

    if (clearBtn) clearBtn.addEventListener('click', clear);
    if (copyBtn) copyBtn.addEventListener('click', () => copyWithFeedback(copyBtn, textEl.value));
    if (expandBtn) expandBtn.addEventListener('click', expand);

    return {
      textEl,
      jsonEditor,
      jsonPreview,
      setValue,
      getValue: () => textEl.value,
      clear,
      expand,
    };
  }

  return { init, copyWithFeedback };
})();

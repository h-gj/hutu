const input = document.getElementById('input');
const output = document.getElementById('output');
const errorEl = document.getElementById('error');
const runBtn = document.getElementById('run-btn');
const autoRun = document.getElementById('auto-run');
const dialectSelect = document.getElementById('dialect');
const keywordCaseSelect = document.getElementById('keyword-case');
const indentSelect = document.getElementById('indent');
const validationSection = document.getElementById('validation-section');
const validationStatus = document.getElementById('validation-status');
const errorList = document.getElementById('error-list');

let timer = null;

const SAMPLE_SQL = `select u.id,u.name,o.total from users u left join orders o on u.id=o.user_id where u.status=1 and o.total>100 order by o.total desc limit 20;`;

function showApiError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function hideApiError() {
  errorEl.hidden = true;
}

function renderValidation(validation) {
  if (!validation) {
    validationSection.hidden = true;
    return;
  }

  validationSection.hidden = false;
  const valid = validation.valid;
  validationStatus.textContent = valid ? '语法正确' : '存在语法问题';
  validationStatus.className = `sql-status ${valid ? 'ok' : 'err'}`;

  const errors = validation.errors || [];
  if (valid || errors.length === 0) {
    errorList.innerHTML = '';
    return;
  }

  errorList.innerHTML = errors.map(err => {
    const pos = err.line
      ? `<span class="err-pos">行 ${err.line}${err.column ? `:${err.column}` : ''}</span>`
      : '';
    return `<li>${pos}${escapeHtml(err.message || '未知错误')}</li>`;
  }).join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function run() {
  const sql = input.value;
  if (!sql.trim()) {
    output.value = '';
    hideApiError();
    validationSection.hidden = true;
    return;
  }

  try {
    const res = await fetch('/api/sql-tool/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql,
        dialect: dialectSelect.value,
        keyword_case: keywordCaseSelect.value,
        indent: +indentSelect.value,
        format: true,
        validate: true,
      }),
    });
    const data = await res.json();

    if (!data.ok) {
      output.value = '';
      showApiError(data.error || '处理失败');
      validationSection.hidden = true;
      return;
    }

    hideApiError();
    output.value = data.formatted || '';
    renderValidation(data.validation);
  } catch {
    showApiError('请求失败，请确认 HuTu 服务已启动');
    validationSection.hidden = true;
  }
}

runBtn.addEventListener('click', run);

input.addEventListener('input', () => {
  if (!autoRun.checked) return;
  clearTimeout(timer);
  timer = setTimeout(run, 400);
});

[dialectSelect, keywordCaseSelect, indentSelect].forEach(el => {
  el.addEventListener('change', () => {
    if (autoRun.checked) run();
  });
});

document.getElementById('clear-input').addEventListener('click', () => {
  input.value = '';
  output.value = '';
  hideApiError();
  validationSection.hidden = true;
  input.focus();
});

document.getElementById('copy-output').addEventListener('click', async () => {
  if (!output.value) return;
  const btn = document.getElementById('copy-output');
  const orig = btn.textContent;
  try {
    await navigator.clipboard.writeText(output.value);
    btn.textContent = '已复制';
  } catch {
    output.select();
    document.execCommand('copy');
    btn.textContent = '已复制';
  }
  setTimeout(() => { btn.textContent = orig; }, 1500);
});

input.value = SAMPLE_SQL;
run();

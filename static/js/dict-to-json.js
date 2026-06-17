const input = document.getElementById('input');
const output = document.getElementById('output');
const errorEl = document.getElementById('error');
const convertBtn = document.getElementById('convert');
const autoConvert = document.getElementById('auto-convert');
let timer = null;

async function convert() {
  const text = input.value;
  if (!text.trim()) {
    output.value = '';
    errorEl.hidden = true;
    return;
  }

  try {
    const res = await fetch('/api/dict-to-json/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (data.ok) {
      output.value = data.result;
      errorEl.hidden = true;
    } else {
      output.value = '';
      errorEl.textContent = data.error;
      errorEl.hidden = false;
    }
  } catch {
    errorEl.textContent = '请求失败，请确认服务已启动';
    errorEl.hidden = false;
  }
}

convertBtn.addEventListener('click', convert);

input.addEventListener('input', () => {
  if (!autoConvert.checked) return;
  clearTimeout(timer);
  timer = setTimeout(convert, 300);
});

document.getElementById('clear-input').addEventListener('click', () => {
  input.value = '';
  output.value = '';
  errorEl.hidden = true;
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

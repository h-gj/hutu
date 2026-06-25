const SNIPPETS = [
  { lang: 'JavaScript', code: 'Math.floor(Date.now() / 1000)\n// 毫秒: Date.now()' },
  { lang: 'Python', code: 'import time\ntime.time()  # 秒\n# 毫秒: int(time.time() * 1000)' },
  { lang: 'Java', code: 'System.currentTimeMillis() / 1000  // 秒\n// 毫秒: System.currentTimeMillis()\n// Java 8+: Instant.now().getEpochSecond()' },
  { lang: 'Go', code: 'import "time"\ntime.Now().Unix()  // 秒\n// 毫秒: time.Now().UnixMilli()' },
  { lang: 'PHP', code: 'time()  // 秒\n// 毫秒: round(microtime(true) * 1000)' },
  { lang: 'Ruby', code: 'Time.now.to_i  // 秒\n// 毫秒: (Time.now.to_f * 1000).to_i' },
  { lang: 'Shell', code: 'date +%s' },
  { lang: 'MySQL', code: 'SELECT UNIX_TIMESTAMP(NOW());' },
  { lang: 'SQLite', code: "SELECT strftime('%s', 'now');" },
  { lang: 'C# / .NET', code: 'DateTimeOffset.UtcNow.ToUnixTimeSeconds();\n// 毫秒: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()' },
  { lang: 'Swift', code: 'Int(Date().timeIntervalSince1970)' },
  { lang: 'Lua', code: 'os.time()' },
  { lang: 'Erlang', code: 'calendar:datetime_to_gregorian_seconds(calendar:universal_time()) - 719528 * 24 * 3600.' },
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function formatUtc(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`;
}

function toDatetimeLocalValue(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function parseTimestampInput(raw, unitMode) {
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  let num;
  if (/^\d+$/.test(trimmed)) {
    num = Number(trimmed);
  } else if (/^\d+\.\d+$/.test(trimmed)) {
    num = Number(trimmed);
  } else {
    return { error: '时间戳应为数字' };
  }

  if (!Number.isFinite(num)) {
    return { error: '无效的时间戳' };
  }

  let ms;
  if (unitMode === 's') {
    ms = num * 1000;
  } else if (unitMode === 'ms') {
    ms = num;
  } else {
    // auto: >= 1e12 treat as ms, else seconds (also handle float seconds)
    ms = num >= 1e12 || num < -1e11 ? num : num * 1000;
  }

  if (ms < -864000000000000 || ms > 8640000000000000) {
    return { error: '时间戳超出有效范围' };
  }

  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return { error: '无法解析为有效日期' };
  }

  return { date, ms };
}

function parseDateInput(dtLocal, isoRaw) {
  const iso = String(isoRaw || '').trim();
  if (iso) {
    const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T');
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) {
      return { error: '无法解析 ISO / 日期字符串' };
    }
    return { date: d };
  }

  if (!dtLocal) {
    return { error: '请选择日期时间或输入 ISO 字符串' };
  }

  const d = new Date(dtLocal);
  if (Number.isNaN(d.getTime())) {
    return { error: '无效的日期时间' };
  }
  return { date: d };
}

function showError(el, msg) {
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.hidden = false;
  } else {
    el.hidden = true;
    el.textContent = '';
  }
}

async function copyText(text, btn) {
  if (!text) return;
  const orig = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
  btn.textContent = '已复制';
  setTimeout(() => { btn.textContent = orig; }, 1500);
}

function updateNow() {
  const now = Date.now();
  const d = new Date(now);
  const secEl = document.getElementById('now-seconds');
  const msEl = document.getElementById('now-millis');
  const localEl = document.getElementById('now-local');
  const utcEl = document.getElementById('now-utc');

  if (secEl) secEl.textContent = String(Math.floor(now / 1000));
  if (msEl) msEl.textContent = String(now);
  if (localEl) localEl.textContent = formatLocal(d);
  if (utcEl) utcEl.textContent = formatUtc(d);
}

function getTsUnitMode() {
  const checked = document.querySelector('input[name="ts-unit"]:checked');
  return checked ? checked.value : 'auto';
}

function getTsTzMode() {
  const checked = document.querySelector('input[name="ts-tz"]:checked');
  return checked ? checked.value : 'local';
}

function convertTsToDate() {
  const input = document.getElementById('ts-input');
  const resultEl = document.getElementById('ts-to-date-result');
  const errorEl = document.getElementById('ts-to-date-error');
  const parsed = parseTimestampInput(input.value, getTsUnitMode());

  if (!parsed) {
    showError(errorEl, '请输入时间戳');
    resultEl.hidden = true;
    return;
  }
  if (parsed.error) {
    showError(errorEl, parsed.error);
    resultEl.hidden = true;
    return;
  }

  showError(errorEl, null);
  const { date, ms } = parsed;
  const tz = getTsTzMode();

  const standard = tz === 'utc' ? formatUtc(date) : formatLocal(date);
  const iso = date.toISOString();
  const utc = formatUtc(date);
  const local = formatLocal(date);

  document.getElementById('ts-out-standard').textContent = standard;
  document.getElementById('ts-out-iso').textContent = iso;
  document.getElementById('ts-out-utc').textContent = utc;
  document.getElementById('ts-out-local').textContent = local;
  resultEl.hidden = false;
}

function convertDateToTs() {
  const dtInput = document.getElementById('dt-input');
  const isoInput = document.getElementById('dt-iso-input');
  const resultEl = document.getElementById('date-to-ts-result');
  const errorEl = document.getElementById('date-to-ts-error');
  const parsed = parseDateInput(dtInput.value, isoInput.value);

  if (parsed.error) {
    showError(errorEl, parsed.error);
    resultEl.hidden = true;
    return;
  }

  showError(errorEl, null);
  const ms = parsed.date.getTime();
  const sec = Math.floor(ms / 1000);

  document.getElementById('dt-out-seconds').textContent = String(sec);
  document.getElementById('dt-out-millis').textContent = String(ms);
  resultEl.hidden = false;
}

function fillNowDatetime() {
  const now = new Date();
  document.getElementById('dt-input').value = toDatetimeLocalValue(now);
  document.getElementById('dt-iso-input').value = '';
}

function fillNowTimestamp() {
  document.getElementById('ts-input').value = String(Math.floor(Date.now() / 1000));
}

function initSnippets() {
  const tbody = document.getElementById('snippet-tbody');
  if (!tbody) return;

  SNIPPETS.forEach((item) => {
    const tr = document.createElement('tr');
    const langTd = document.createElement('td');
    langTd.textContent = item.lang;

    const codeTd = document.createElement('td');
    const codeEl = document.createElement('code');
    codeEl.textContent = item.code;
    codeTd.appendChild(codeEl);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn-link ts-snippet-copy';
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', () => copyText(item.code, copyBtn));
    codeTd.appendChild(copyBtn);

    tr.appendChild(langTd);
    tr.appendChild(codeTd);
    tbody.appendChild(tr);
  });
}

function initSnippetToggle() {
  const toggle = document.getElementById('snippet-toggle');
  const body = document.getElementById('snippet-body');
  if (!toggle || !body) return;

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    body.hidden = expanded;
  });
}

document.querySelectorAll('.ts-copy').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-copy');
    const el = document.getElementById(id);
    if (el) copyText(el.textContent, btn);
  });
});

document.querySelectorAll('.ts-copy-inline').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-target');
    const el = document.getElementById(id);
    if (el) copyText(el.textContent, btn);
  });
});

document.getElementById('ts-use-now').addEventListener('click', () => {
  fillNowTimestamp();
  convertTsToDate();
});
document.getElementById('dt-use-now').addEventListener('click', () => {
  fillNowDatetime();
  convertDateToTs();
});

document.getElementById('ts-input').addEventListener('input', () => {
  if (document.getElementById('ts-input').value.trim()) convertTsToDate();
});
document.querySelectorAll('input[name="ts-unit"], input[name="ts-tz"]').forEach((el) => {
  el.addEventListener('change', convertTsToDate);
});

document.getElementById('dt-input').addEventListener('change', convertDateToTs);
document.getElementById('dt-iso-input').addEventListener('input', () => {
  if (document.getElementById('dt-iso-input').value.trim()) convertDateToTs();
});

const backToTopBtn = document.getElementById('back-to-top');
function updateBackToTop() {
  if (!backToTopBtn) return;
  backToTopBtn.hidden = window.scrollY < 200;
}
backToTopBtn?.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
window.addEventListener('scroll', updateBackToTop, { passive: true });

updateNow();
setInterval(updateNow, 1000);
initSnippets();
initSnippetToggle();
updateBackToTop();

fillNowTimestamp();
convertTsToDate();
fillNowDatetime();
convertDateToTs();

const form = document.getElementById('login-form');
const errorEl = document.getElementById('login-error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.hidden = true;

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (data.ok) {
      window.location.href = '/admin/';
    } else {
      errorEl.textContent = data.error || '登录失败';
      errorEl.hidden = false;
    }
  } catch {
    errorEl.textContent = '请求失败，请确认服务已启动';
    errorEl.hidden = false;
  }
});

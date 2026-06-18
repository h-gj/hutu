const SLUG_RE = /^[a-z0-9]{3,32}$/;

function randomSlug(length = 4) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let slug = '';
  for (let i = 0; i < length; i++) {
    slug += chars[Math.floor(Math.random() * chars.length)];
  }
  return slug;
}

function goToSlug(slug) {
  const normalized = slug.trim().toLowerCase();
  if (!SLUG_RE.test(normalized)) {
    alert('地址名仅支持 3-32 位小写字母和数字');
    return;
  }
  location.href = `/${normalized}`;
}

document.getElementById('start-new-note').addEventListener('click', () => {
  location.href = `/${randomSlug()}`;
});

document.getElementById('open-note').addEventListener('click', () => {
  goToSlug(document.getElementById('open-slug').value);
});

document.getElementById('open-slug').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') goToSlug(e.target.value);
});

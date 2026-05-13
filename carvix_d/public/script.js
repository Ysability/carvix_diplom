/* ===========================================
   Carvix — Auth UI logic
   =========================================== */

const API = '/api/auth';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------- Если уже залогинен — на dashboard ---------- */
(function autoRedirect() {
  const token = localStorage.getItem('carvix_token');
  if (token && location.pathname === '/') {
    fetch(`${API}/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? location.replace('/app.html') : null))
      .catch(() => {});
  }
})();

/* ---------- Tabs ---------- */
const tabs = $('.tabs');
const tabButtons = $$('.tab', tabs);
const forms = {
  login: $('#form-login'),
  register: $('#form-register'),
};

function switchTab(target) {
  tabButtons.forEach((b) => {
    const active = b.dataset.target === target;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', String(active));
  });
  tabs.dataset.active = target;

  Object.entries(forms).forEach(([key, el]) => {
    const active = key === target;
    el.classList.toggle('is-active', active);

    // Анимации появления полей — только при первом показе каждой формы.
    if (active && !el.dataset.shown) {
      el.dataset.shown = '1';
      el.classList.add('animate-once');
      setTimeout(() => el.classList.remove('animate-once'), 1100);
    }
  });
}
// Первичная форма (login) уже видима — помечаем её как показанную
forms.login.dataset.shown = '1';
setTimeout(() => forms.login.classList.remove('animate-once'), 1100);

tabs.dataset.active = 'login';
tabButtons.forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.target)));
$$('[data-switch]').forEach((b) =>
  b.addEventListener('click', () => switchTab(b.dataset.switch))
);

/* ---------- Toggle password ---------- */
$$('.field__toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = btn.parentElement.querySelector('input');
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.style.color = input.type === 'text' ? 'var(--accent)' : '';
  });
});

/* ---------- Caps Lock detection ---------- */
$$('input[type="password"]').forEach((input) => {
  const hint = input.closest('.field')?.querySelector('.field__capslock');
  if (!hint) return;
  input.addEventListener('keydown', (e) => {
    hint.hidden = !e.getModifierState('CapsLock');
  });
  input.addEventListener('keyup', (e) => {
    hint.hidden = !e.getModifierState('CapsLock');
  });
  input.addEventListener('blur', () => { hint.hidden = true; });
});

/* ---------- Toast ---------- */
const toastEl = $('#toast');
let toastTimer = null;
function toast(msg, kind = '') {
  toastEl.textContent = msg;
  toastEl.className = 'toast is-show ' + (kind ? `is-${kind}` : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('is-show');
  }, 3200);
}

/* ---------- Helpers для форм ---------- */
function setLoading(form, loading) {
  const btn = $('.btn-primary', form);
  if (!btn) return;
  btn.classList.toggle('is-loading', loading);
  btn.disabled = loading;
}

function shake(form) {
  form.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-8px)' },
      { transform: 'translateX(8px)' },
      { transform: 'translateX(-4px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 360, easing: 'ease-in-out' }
  );
}

/* ---------- Counter-анимация мини-статов ---------- */
function animateCounter(el) {
  const target = Number(el.dataset.target);
  if (!target) return;
  const duration = 1200;
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(target * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
setTimeout(() => {
  $$('.stat__num[data-target]').forEach(animateCounter);
}, 950);

/* ---------- LOGIN ---------- */
forms.login.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(forms.login);
  const body = {
    login: fd.get('login')?.toString().trim(),
    password: fd.get('password')?.toString(),
  };

  if (!body.login || !body.password) {
    shake(forms.login);
    return toast('Заполните логин и пароль', 'error');
  }

  setLoading(forms.login, true);
  try {
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка входа');

    localStorage.setItem('carvix_token', data.token);
    localStorage.setItem('carvix_user', JSON.stringify(data.user));

    toast(`Добро пожаловать, ${data.user.fio.split(' ')[0]}!`, 'success');
    setTimeout(() => location.assign('/app.html'), 600);
  } catch (err) {
    shake(forms.login);
    toast(err.message, 'error');
  } finally {
    setLoading(forms.login, false);
  }
});

/* ---------- REGISTER ---------- */
forms.register.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(forms.register);
  const body = {
    fio: fd.get('fio')?.toString().trim(),
    login: fd.get('login')?.toString().trim(),
    password: fd.get('password')?.toString(),
  };

  if (!body.fio || !body.login || !body.password) {
    shake(forms.register);
    return toast('Заполните все поля', 'error');
  }
  if (body.password.length < 6) {
    shake(forms.register);
    return toast('Пароль должен быть не менее 6 символов', 'error');
  }
  const confirm = fd.get('password_confirm')?.toString();
  if (body.password !== confirm) {
    shake(forms.register);
    return toast('Пароли не совпадают', 'error');
  }

  setLoading(forms.register, true);
  try {
    const res = await fetch(`${API}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка регистрации');

    localStorage.setItem('carvix_token', data.token);
    localStorage.setItem('carvix_user', JSON.stringify(data.user));

    toast('Аккаунт создан', 'success');
    setTimeout(() => location.assign('/app.html'), 600);
  } catch (err) {
    shake(forms.register);
    toast(err.message, 'error');
  } finally {
    setLoading(forms.register, false);
  }
});

/* ---------- Лёгкий parallax для блобов ---------- */
const blobs = $$('.blob');
window.addEventListener('mousemove', (e) => {
  const x = (e.clientX / window.innerWidth - 0.5) * 2;
  const y = (e.clientY / window.innerHeight - 0.5) * 2;
  blobs.forEach((b, i) => {
    const k = (i + 1) * 8;
    b.style.translate = `${x * k}px ${y * k}px`;
  });
});

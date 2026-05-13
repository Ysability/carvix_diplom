/* ============================================================
   Carvix — переключатель темы (light / dark).
   Атрибут на <html>: data-theme="light" | "dark".
   Хранение: localStorage.carvix_theme.
   Default: prefers-color-scheme.
   ============================================================ */
(function () {
  function getTheme() {
    const saved = localStorage.getItem('carvix_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
  }

  function setTheme(theme) {
    if (theme !== 'light' && theme !== 'dark') theme = 'light';
    localStorage.setItem('carvix_theme', theme);
    applyTheme(theme);
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }

  function toggleTheme() {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  }

  // Применяем максимально рано (до первого paint), чтобы избежать вспышки.
  applyTheme(getTheme());

  window.getTheme = getTheme;
  window.setTheme = setTheme;
  window.toggleTheme = toggleTheme;
})();

function applyRememberedThemeToBody() {
  const theme = window.__GNC_PREPAINT_THEME__ === 'dark' ? 'dark' : 'light';
  document.body.dataset.opsTheme = theme;
  document.body.dataset.opsThemeMode = theme;
  document.body.style.colorScheme = theme;
}

applyRememberedThemeToBody();

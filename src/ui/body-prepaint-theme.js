export function applyRememberedThemeToBody() {
  const theme = 'dark';
  document.body.dataset.opsTheme = theme;
  document.body.dataset.opsThemeMode = theme;
  document.body.style.colorScheme = theme;
}

applyRememberedThemeToBody();

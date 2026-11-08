export function getRequestUrl(requestOrUrl) {
  try {
    const value = typeof requestOrUrl === 'string' ? requestOrUrl : requestOrUrl && (requestOrUrl.url || requestOrUrl.href);
    return value ? new URL(value, self.location.href) : null;
  } catch {
    return null;
  }
}

export function isProductionShellUrl(value) {
  const url = getRequestUrl(value);
  const scope = getRequestUrl(self.registration.scope);
  if (!url || !scope || url.origin !== scope.origin) return false;
  return url.pathname === scope.pathname || url.pathname === new URL('index.html', scope).pathname;
}



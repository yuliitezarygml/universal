export const sessionCookie = 'iskra_admin_session';

export function api(path, token, options = {}) {
  const base = process.env.ISKRA_SERVER_URL || 'http://127.0.0.1:8080';
  return fetch(new URL(path, base), {
    ...options,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}

import { createAuthClient } from 'better-auth/client';

// single better-auth client for the web app, same-origin. we set basePath rather
// than baseURL: better-auth 1.6.15 rejects a relative baseURL ('/api' throws
// "invalid base url" — it requires a protocol) and a path-bearing baseURL would
// bypass basePath entirely. with basePath only, the client resolves the base to
// window.location.origin + '/api/auth' — exactly the server's effective path
// (global '/api' prefix + server basePath '/auth'). same-origin keeps cookies
// host-only / samesite=lax with no cors-credentials dance.
// the i/o lives here; the shared session signal that guard + interceptor read is in
// core/stores/auth.store.ts.
export const authClient = createAuthClient({ basePath: '/api/auth' });

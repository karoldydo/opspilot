import { createAuthClient } from 'better-auth/client';

// better-auth client, same-origin. basePath not baseURL: 1.6.15 rejects a relative
// baseURL (needs a protocol), so basePath resolves to origin + '/api/auth' (global
// '/api' prefix + server basePath '/auth'). shared session signal lives in auth.store.ts.
export const authClient = createAuthClient({ basePath: '/api/auth' });

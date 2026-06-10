// di token for the executor abstraction. interface-based di resolves to
// undefined under the vitest/esbuild transform (it drops design:paramtypes),
// so every consumer injects this explicit token (see lessons.md).
export const EXECUTOR = Symbol('EXECUTOR');

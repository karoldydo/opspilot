// di token for the executor: interface-based di resolves to undefined under the
// esbuild/vitest transform (drops design:paramtypes), so consumers inject this (lessons.md).
export const EXECUTOR = Symbol('EXECUTOR');

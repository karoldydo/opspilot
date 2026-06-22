import { runNarrationEventSchema } from './run-narration-event.schema';

describe('runNarrationEventSchema', () => {
  it('accepts a valid step frame', () => {
    const frame = { step: { kind: 'ok' as const, text: 'received 200 lines (18.4 KB)' }, type: 'step' as const };

    expect(runNarrationEventSchema.parse(frame)).toEqual(frame);
  });

  it('accepts a valid progress frame', () => {
    const frame = { elapsedMs: 4200, phase: 'analyzing' as const, type: 'progress' as const };

    expect(runNarrationEventSchema.parse(frame)).toEqual(frame);
  });

  it('rejects a step frame with an unknown kind', () => {
    const frame = { step: { kind: 'bogus', text: 'nope' }, type: 'step' };

    expect(runNarrationEventSchema.safeParse(frame).success).toBe(false);
  });

  it('rejects a progress frame with a negative elapsedMs', () => {
    const frame = { elapsedMs: -1, phase: 'analyzing', type: 'progress' };

    expect(runNarrationEventSchema.safeParse(frame).success).toBe(false);
  });
});

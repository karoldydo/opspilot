import { STATUS_RANK, statusFromSynthesis, worstStatus } from './status';

describe('status util', () => {
  describe('statusFromSynthesis', () => {
    it('maps null/undefined (no runs) to the client-only unknown', () => {
      expect(statusFromSynthesis(null)).toBe('unknown');
      expect(statusFromSynthesis(undefined)).toBe('unknown');
    });

    it('passes the three wire statuses through unchanged', () => {
      expect(statusFromSynthesis('healthy')).toBe('healthy');
      expect(statusFromSynthesis('degraded')).toBe('degraded');
      expect(statusFromSynthesis('down')).toBe('down');
    });
  });

  describe('STATUS_RANK', () => {
    it('ranks worst-first on ascending: down < degraded < healthy < unknown', () => {
      expect(STATUS_RANK.down).toBeLessThan(STATUS_RANK.degraded);
      expect(STATUS_RANK.degraded).toBeLessThan(STATUS_RANK.healthy);
      expect(STATUS_RANK.healthy).toBeLessThan(STATUS_RANK.unknown);
    });
  });

  describe('worstStatus', () => {
    it('picks the worst (lowest-rank) status across a host', () => {
      expect(worstStatus(['healthy', 'down', 'degraded'])).toBe('down');
      expect(worstStatus(['healthy', 'degraded'])).toBe('degraded');
      expect(worstStatus(['healthy', 'healthy'])).toBe('healthy');
    });

    it('rolls up an empty list to unknown', () => {
      expect(worstStatus([])).toBe('unknown');
    });

    it('rolls up an all-unknown list to unknown', () => {
      expect(worstStatus(['unknown', 'unknown'])).toBe('unknown');
    });

    it('treats a present status as worse than unknown', () => {
      expect(worstStatus(['unknown', 'healthy'])).toBe('healthy');
    });
  });
});

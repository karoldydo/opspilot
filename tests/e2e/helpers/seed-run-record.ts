import type { DiagnosisSynthesis } from '@opspilot/shared';

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

// the e2e api boots with DATABASE_PATH=./data/opspilot.e2e.db relative to repo root
// (playwright.config sets cwd: rootDir). resolve the same file from this helper's dir
// (tests/e2e/helpers -> repo root).
const DB_PATH = resolve(__dirname, '../../../data/opspilot.e2e.db');

// inserts one completed run_record row directly into the e2e db. there is no api
// endpoint to create a run — runs are persisted only by the live diagnose stream,
// which needs a real ssh host + a real llm, neither deterministic in e2e. so a saved-run
// fixture has to be seeded at the db, mirroring run-record.service.create's columns
// (synthesis stored as json text, created_at as epoch ms). returns the new run id.
export function seedRunRecord(input: {
  createdAtMs?: number;
  deviceId: string;
  serviceId: string;
  synthesis: DiagnosisSynthesis;
}): string {
  // open a second connection; the api holds the db in wal mode, so a brief writer lock
  // (bounded by busy_timeout) lets this insert commit and become visible to the api's reads.
  const db = new Database(DB_PATH);
  try {
    db.pragma('busy_timeout = 5000');
    const id = randomUUID();
    db.prepare(
      `insert into run_record (id, device_id, service_id, synthesis, created_at, duration_ms)
       values (?, ?, ?, ?, ?, ?)`
    ).run(id, input.deviceId, input.serviceId, JSON.stringify(input.synthesis), input.createdAtMs ?? Date.now(), 1500);
    return id;
  } finally {
    db.close();
  }
}

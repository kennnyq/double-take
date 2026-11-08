/** Explicit design-only backend. No inference, findings, or hosted calls. */
import { resolve } from 'node:path';
import { startServer } from './server.ts';
if (!process.env.JOBS_DIR) throw new Error('Set JOBS_DIR to a private preview data directory');
await startServer(resolve(process.env.JOBS_DIR), Number(process.env.PORT ?? 8792), async (_dir, job) => {
  // Gives designers a reproducible processing state; not inference latency.
  await new Promise(done => setTimeout(done, 3500));
  return { version: 1, clipId: job.id, mediaSha256: job.sha256, mode: 'fixture',
    components: ['visuals', 'subject', 'audio'].map(component => ({ component: component as 'visuals' | 'subject' | 'audio', assessment: component === 'audio' && !job.hasAudio ? 'not_applicable' : 'unknown', summary: 'No assessment in design preview.', evidenceIds: [] })),
    evidence: [], limitations: ['Design preview only; no analysis was performed. Walkthrough is instructional, not a detection result.'], trace: [], elapsedMs: 0 };
});

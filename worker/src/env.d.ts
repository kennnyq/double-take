// The R2 binding is only present when STORAGE is "r2" (see wrangler.jsonc).
interface Env {
  MEDIA?: R2Bucket;
  // Dev-only test-account routes (src/devAuth.ts). Set in worker/.dev.vars only, never in production.
  DEV_AUTH?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}

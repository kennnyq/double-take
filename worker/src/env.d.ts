// The R2 binding is only present when STORAGE is "r2" (see wrangler.jsonc).
interface Env {
  MEDIA?: R2Bucket;
}

-- demo_checks, for the hill climb's portable stage bundle (prepared-source-url-v1):
--   job          the full public GET /jobs/<id> envelope (result is its .result)
--   media_sha256 the stored video's SHA-256, on link rows too (they share the
--                file rows' video; only file rows are looked up by sha256)
--   reference    provenance: the recorded reference label's source and basis
alter table public.demo_checks
  add column job jsonb,
  add column media_sha256 text check (media_sha256 ~ '^[0-9a-f]{64}$'),
  add column reference jsonb;

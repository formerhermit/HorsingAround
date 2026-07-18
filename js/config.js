// config.js — Supabase project credentials for cloud save sync.
//
// The publishable (formerly "anon") key is safe to commit: it's meant to be
// public, and every table it can touch is locked down by Row Level Security
// (see supabase/schema.sql). Get both values from your Supabase project
// dashboard: Settings → API. Don't use a JWT signing key here — those are
// for independently verifying Supabase-issued tokens, not for API access.
//
// Left as placeholders, the game just runs on localStorage only — see
// isConfigured() in cloud.js.

export const SUPABASE_URL = 'https://jtkpcnmpfvizgouhlzng.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_2pUsw8J-LmEtXLfkPwLUdw_PG04TjXu';

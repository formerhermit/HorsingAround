// config.js — Supabase project credentials for cloud save sync.
//
// The anon key is safe to commit: it's meant to be public, and every table
// it can touch is locked down by Row Level Security (see supabase/schema.sql).
// Get both values from your Supabase project dashboard: Settings → API.
//
// Left as placeholders, the game just runs on localStorage only — see
// isConfigured() in cloud.js.

export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';

// Single Supabase module. `use` facades (.ts) can import; Custom (.js) files cannot,
// so we expose the client on globalThis for the headless Custom auth bridges to read.
// The publishable key is public by design; RLS on the DB is what protects data.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://agutaluxzruuthbbagkh.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_2OTPocZUTdUcLo18VmmDWg_sksO5uqj";

export const supa: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Bridge to the Custom (.js) files, which run inlined and cannot import.
(globalThis as Record<string, unknown>).__supa = supa;

// Fire-and-forget side effect callable from a Muten action.
// The auth listener (SupaSession) mirrors the resulting state back into the store.
export function signOut(): void {
  supa.auth.signOut();
}

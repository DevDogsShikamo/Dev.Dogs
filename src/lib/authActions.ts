// Single Supabase module. `use` facades (.ts) can import; Custom (.js) files cannot,
// so we expose the client on globalThis for the headless Custom auth bridges to read.
// The publishable key is public by design; RLS on the DB is what protects data.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://agutaluxzruuthbbagkh.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_2OTPocZUTdUcLo18VmmDWg_sksO5uqj";

export const supa: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Bridge to the Custom (.js) files, which run inlined and cannot import.
const g = globalThis as Record<string, unknown>;
g.__supa = supa;

// ---- Shared session resolver (single source of truth for identity) ----------
// Every data bridge (DataBootstrap, Empresa/Reportes/Salidas, Cliente, Horario)
// needs {uid, negocioId}. Custom .js files cannot import, so instead of each one
// redefining the same readLS + resolve, we resolve it ONCE here and expose it on
// globalThis.__ddSesion. Fast path: the auth store persists userId/negocioId in
// localStorage (0 network); fallback: getUser -> profiles. Memoized, and cleared
// on signOut so a re-login in the same page load never returns the previous user.
type Sesion = { uid: string | null; negocioId: string | null };
let sesionMemo: Promise<Sesion> | null = null;

function readLS(k: string): string | null {
  try {
    const v = localStorage.getItem("muten:auth:" + k);
    return v ? (JSON.parse(v) as string) : null;
  } catch {
    return null;
  }
}

function resolveSesion(): Promise<Sesion> {
  if (sesionMemo) return sesionMemo;
  const uid = readLS("userId");
  const neg = readLS("negocioId");
  if (uid && neg) {
    sesionMemo = Promise.resolve({ uid, negocioId: neg });
    return sesionMemo;
  }
  // Read the client at call time (same convention the bridges follow), not the
  // import binding: in prod they are the same object, but this keeps the fallback
  // robust if the client is swapped after boot.
  const client = ((globalThis as Record<string, unknown>).__supa as SupabaseClient) || supa;
  sesionMemo = client.auth.getUser().then((u) => {
    const id = u.data.user && u.data.user.id;
    if (!id) {
      sesionMemo = null; // no user yet: don't cache, let the next call retry
      return { uid: null, negocioId: null };
    }
    return client
      .from("profiles")
      .select("negocio_id")
      .eq("id", id)
      .single()
      .then((pr) => ({ uid: id, negocioId: (pr.data && pr.data.negocio_id) || null }));
  });
  return sesionMemo;
}
g.__ddSesion = resolveSesion;

// Fire-and-forget side effect callable from a Muten action.
// Clears the cached identity so the next login resolves a fresh session.
export function signOut(): void {
  supa.auth.signOut();
  sesionMemo = null;
}

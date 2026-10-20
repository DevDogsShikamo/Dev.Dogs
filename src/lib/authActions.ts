// Single Supabase module. `use` facades (.ts) can import; Custom (.js) files cannot,
// so we expose the client on globalThis for the headless Custom auth bridges to read.
// The publishable key is public by design; RLS on the DB is what protects data.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { purgeKeys, shouldPurge } from "./localData.js";

// Test hook: the E2E harness sets window.__DD_CFG = { url, key, fotos } to point the app at
// STAGING (Supabase and the photo Worker). It is honoured ONLY on localhost / 127.0.0.1; anywhere else the production
// constants below are used, whatever the page sets.
type Cfg = { url: string; key: string; fotos: string };
const isLocal = typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1");
const override = isLocal ? (window as unknown as { __DD_CFG?: Partial<Cfg> }).__DD_CFG : undefined;
const cfg: Cfg = {
  url: (override && override.url) || "https://agutaluxzruuthbbagkh.supabase.co",
  key: (override && override.key) || "sb_publishable_2OTPocZUTdUcLo18VmmDWg_sksO5uqj",
  fotos: (override && override.fotos) || "https://devdogs-fotos.devdogsco.workers.dev", // walk-photo Worker (S5b)
};

export const supa: SupabaseClient = createClient(cfg.url, cfg.key);

// Bridge to the Custom (.js) files, which run inlined and cannot import.
const g = globalThis as Record<string, unknown>;
g.__supa = supa;
g.__ddCfg = cfg; // Custom files read the effective url/key here instead of duplicating them
g.__ddFotos = cfg.fotos; // FotoUpload.js / ClienteBridge.js talk to the photo Worker at this origin

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

export function resolveSesion(): Promise<Sesion> {
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
  // Offline the revoke call fails and supabase-js then keeps the session (even scope "local" calls
  // the server), so the stored token is dropped by hand and the device purged. The server-side
  // refresh token stays valid until it expires: it cannot be revoked without a network.
  supa.auth.signOut().then((r) => {
    if (r && r.error) {
      localStorage.removeItem(authKey);
      purge();
    }
  });
  sesionMemo = null;
}

// "Continuar con Google/Apple/Microsoft": a top-level navigation to Supabase /auth/v1/authorize, then the
// provider, then back to /login with the session in the URL. supabase-js stores it on load and
// SupaAuthForm reports it (a first-time user has no profile yet and lands on /completar-registro).
// Fire-and-forget: `use` is sync. Microsoft is "azure" in Supabase and needs the email scope.
export function entrarCon(proveedor: string): void {
  if (proveedor !== "google" && proveedor !== "apple" && proveedor !== "azure") return;
  supa.auth.signInWithOAuth({
    provider: proveedor,
    options: { redirectTo: location.origin + "/login", ...(proveedor === "azure" ? { scopes: "email" } : {}) },
  });
}

// ---- End of session: purge what is on the device (design section 7) ----------
// The auth session key supabase-js uses; its presence tells "token gone" from "network down".
const authKey = "sb-" + new URL(cfg.url).hostname.split(".")[0] + "-auth-token";

// Id of the user whose session is stored. Synchronous and valid offline (the outbox needs it
// to tag and replay only the current user's operations).
export function currentUid(): string {
  try {
    const s = JSON.parse(localStorage.getItem(authKey) || "null");
    return (s && s.user && s.user.id) || "";
  } catch {
    return "";
  }
}
g.__ddUid = currentUid; // NetWatch.js (a Custom, cannot import) counts only this user's queue

function purge(): void {
  purgeKeys(localStorage);
  // Nothing caches photos today (the service worker never touches the photo Worker); this keeps it so
  // if a photo cache ever appears: no photo survives the end of a session.
  if (typeof caches !== "undefined") caches.keys().then((ks) => ks.filter((k) => /^fotos/i.test(k)).forEach((k) => caches.delete(k)));
  supa.removeAllChannels();
  sesionMemo = null;
  // A hard reload is what clears the in-memory stores (TypeScript cannot call store actions).
  // Muten writes its in-memory state back to localStorage while the page unloads, so /boot.js
  // repeats the purge on the next load, before the app reads anything (it looks for this flag).
  sessionStorage.setItem("dd_purge", "1");
  location.replace("/login");
}

supa.auth.onAuthStateChange((event, session) => {
  const flag = localStorage.getItem("muten:auth:loggedIn");
  if (
    shouldPurge({
      event,
      session,
      online: navigator.onLine,
      hasToken: localStorage.getItem(authKey) !== null,
      loggedIn: flag === "true",
    })
  ) {
    purge();
  }
});

// ---- Shared bridge utilities (globalThis.__ddUtils) --------------------------
// Custom (.js) files cannot import, so the date/color/toast/menu helpers that
// were duplicated across 8+ bridges are consolidated here, at the same bootstrap
// insertion point as __ddSesion above — every bridge can read __ddUtils on first
// use with no race.
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(d: Date): string {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function today(): string {
  return iso(new Date());
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

// Color por tipo de servicio (calendario/agenda).
function colorFor(tipo: string): string {
  if (tipo === "paseo") return "purple";
  if (tipo === "guarderia") return "blue";
  if (tipo === "veterinaria") return "green";
  if (tipo === "bano") return "teal";
  if (tipo === "corte") return "orange";
  if (tipo === "adiestramiento") return "pink";
  return "yellow"; // comida / accesorio / otros
}

// Aviso liviano (lo muestra el Custom Toast.js). Único export: data/export/share/
// outbox.ts lo importan; los bridges .js lo leen vía __ddUtils.toast.
export function toast(msg: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("toast", { detail: msg }));
  }
}

// Popover compartido "Solo hoy / Siempre / Cancelar" (drag & drop de grupos/bloques
// en CalendarioDnD.js y Organizador.js). El caller pasa el título ya localizado
// (varía por caso de uso); el modo elegido ("hoy"|"siempre") vuelve por onMode.
// "cancel" cierra el popover sin invocar onMode.
function askMode(x: number, y: number, title: string, onMode: (modo: string) => void): void {
  const STR: Record<string, { hoy: string; siempre: string; cancelar: string }> = {
    es: { hoy: "Solo hoy", siempre: "Siempre (recurrente)", cancelar: "Cancelar" },
    en: { hoy: "Only today", siempre: "Always (recurring)", cancelar: "Cancel" },
  };
  const t = STR[g.__lang === "en" ? "en" : "es"];
  const pop = document.createElement("div");
  pop.className = "dd-org-pop";
  pop.innerHTML =
    '<div class="t">' + title + "</div>" +
    '<button type="button" data-m="hoy">' + t.hoy + "</button>" +
    '<button type="button" data-m="siempre">' + t.siempre + "</button>" +
    '<button type="button" data-m="cancel" class="c">' + t.cancelar + "</button>";
  pop.style.left = Math.max(8, Math.min(x - 90, window.innerWidth - 210)) + "px";
  pop.style.top = Math.min(y + 8, window.innerHeight - 170) + "px";
  document.body.appendChild(pop);
  function close(): void {
    pop.remove();
    document.removeEventListener("pointerdown", outside, true);
  }
  function outside(ev: Event): void {
    if (!pop.contains(ev.target as Node)) close();
  }
  setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
  pop.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      const m = (b as HTMLElement).dataset.m;
      close();
      if (m === "cancel" || !m) return;
      onMode(m);
    });
  });
}

g.__ddUtils = { iso, today, pad, addDays, colorFor, toast, askMode };

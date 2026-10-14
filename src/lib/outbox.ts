// Cola de escrituras OFFLINE (outbox). El paseador suele reportar en la calle con
// señal intermitente: si estás offline, la escritura se guarda en localStorage y se
// reproduce sola al volver la conexión (evento "online" + al cargar). El store ya
// mostró el cambio optimista (y persiste), así que la UI no espera a la red.
//
// Hoy encola RPCs (modo paseo: paseo_marcar / paseo_no_salio). Extender a inserts/
// updates es sumar tipos de op acá.
import { currentUid, supa, toast } from "./authActions";
import { classify, opsFor } from "./localData.js";

// Every op is tagged with the user who queued it and only that user replays it. Ops of another
// user stay parked (never replayed, never counted) until a sign-out/expiry purge removes them.
type Op = { kind: "rpc"; name: string; params: Record<string, unknown>; uid: string; at: number };
const KEY = "dd:outbox";

function read(): Op[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as Op[];
  } catch {
    return [];
  }
}
function write(ops: Op[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ops));
  } catch {
    /* noop */
  }
  // Punto ÚNICO de cambio de la cola → avisá a la UI (NetWatch pinta el conteo)
  // sin sondeo. El evento "storage" no dispara en la misma pestaña, este sí.
  try {
    window.dispatchEvent(new CustomEvent("dd:outbox", { detail: opsFor(ops, currentUid()).mine.length }));
  } catch {
    /* noop */
  }
}
function refresh(): void {
  try {
    window.dispatchEvent(new CustomEvent("supa:refresh"));
  } catch {
    /* noop */
  }
}

function offline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

// Cuántas escrituras del usuario actual hay esperando sincronizar.
export function pending(): number {
  return opsFor(read(), currentUid()).mine.length;
}

function enqueue(name: string, params: Record<string, unknown>): void {
  const op: Op = { kind: "rpc", name, params, uid: currentUid(), at: Date.now() };
  const ops = read();
  ops.push(op);
  write(ops);
  toast("Sin conexión — guardado, se sincroniza al volver");
}

let flushing = false;
// Reproduce la cola del usuario actual en orden contra Supabase.
//  - sin red o sesión vencida: corta y conserva el resto (y esa op);
//  - rechazo del servidor: descarta SOLO esa op, la cuenta y avisa; nunca dice "Sincronizado".
export function flush(): void {
  if (flushing || offline()) return;
  const all = read();
  const { mine, parked } = opsFor(all, currentUid());
  if (!mine.length) return;
  flushing = true;
  let rejected = 0;
  const finish = (keep: Op[], reason: string): void => {
    write([...parked, ...keep]);
    flushing = false;
    refresh();
    if (rejected) toast(rejected + (rejected === 1 ? " cambio no se pudo aplicar" : " cambios no se pudieron aplicar"));
    else if (reason === "auth") toast("Sesión vencida — iniciá sesión para sincronizar");
    else if (reason === "done") toast("Sincronizado ✓");
  };
  const step = (i: number): void => {
    if (i >= mine.length) return finish([], "done");
    const op = mine[i];
    supa
      .rpc(op.name, op.params)
      .then((r: { error?: unknown; status?: number }) => {
        const c = classify(r as never);
        if (c === "ok") return step(i + 1);
        if (c === "rejected") {
          rejected++;
          return step(i + 1);
        }
        finish(mine.slice(i), c); // network | auth: keep this op and the rest
      })
      .catch(() => finish(mine.slice(i), "network"));
  };
  step(0);
}

// Ejecuta un RPC; offline lo encola. Online, si el servidor lo rechaza revierte (refresh);
// si la red se cae en el intento, lo encola para reintentar.
export function rpcOrQueue(name: string, params: Record<string, unknown>): void {
  if (offline()) {
    enqueue(name, params);
    return;
  }
  supa
    .rpc(name, params)
    .then((r: { error?: unknown; status?: number }) => {
      const c = classify(r as never);
      if (c === "network") enqueue(name, params); // postgrest-js reports a dead network as an error, not a throw
      else if (c === "auth") toast("Sesión vencida — iniciá sesión de nuevo");
      else if (c === "rejected") {
        toast("No se pudo guardar");
        refresh();
      }
    })
    .catch(() => {
      enqueue(name, params);
    });
}

// Sincroniza al volver la conexión y al cargar (por si quedó algo de una sesión offline).
if (typeof window !== "undefined") {
  window.addEventListener("online", flush);
  setTimeout(flush, 1500);
}

// Cola de escrituras OFFLINE (outbox). El paseador suele reportar en la calle con
// señal intermitente: si estás offline, la escritura se guarda en localStorage y se
// reproduce sola al volver la conexión (evento "online" + al cargar). El store ya
// mostró el cambio optimista (y persiste), así que la UI no espera a la red.
//
// Hoy encola RPCs (modo paseo: paseo_marcar / paseo_no_salio). Extender a inserts/
// updates es sumar tipos de op acá.
import { supa, toast } from "./authActions";

type Op = { kind: "rpc"; name: string; params: Record<string, unknown> };
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
    window.dispatchEvent(new CustomEvent("dd:outbox", { detail: ops.length }));
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

// Cuántas escrituras hay esperando sincronizar (para un indicador de UI si se quiere).
export function pending(): number {
  return read().length;
}

function enqueue(op: Op): void {
  const ops = read();
  ops.push(op);
  write(ops);
  toast("Sin conexión — guardado, se sincroniza al volver");
}

let flushing = false;
// Reproduce la cola en orden contra Supabase; corta y conserva el resto si falla la red.
export function flush(): void {
  if (flushing || offline()) return;
  const ops = read();
  if (!ops.length) return;
  flushing = true;
  const step = (i: number): void => {
    if (i >= ops.length) {
      write([]);
      flushing = false;
      refresh();
      toast("Sincronizado ✓");
      return;
    }
    const op = ops[i];
    supa
      .rpc(op.name, op.params)
      .then((r: { error?: unknown }) => {
        // error de SERVIDOR (no de red): descartamos esa op para no trabar la cola.
        if (r && r.error) {
          step(i + 1);
          return;
        }
        step(i + 1);
      })
      .catch(() => {
        // Sigue sin red: conservá lo que falta y reintentá al próximo "online".
        write(ops.slice(i));
        flushing = false;
      });
  };
  step(0);
}

// Ejecuta un RPC; offline lo encola. Online, si el servidor devuelve error revierte
// (refresh); si la red se cae en el intento, lo encola para reintentar.
export function rpcOrQueue(name: string, params: Record<string, unknown>): void {
  if (offline()) {
    enqueue({ kind: "rpc", name, params });
    return;
  }
  supa
    .rpc(name, params)
    .then((r: { error?: unknown }) => {
      if (r && r.error) {
        toast("No se pudo guardar");
        refresh();
      }
    })
    .catch(() => {
      enqueue({ kind: "rpc", name, params });
    });
}

// Sincroniza al volver la conexión y al cargar (por si quedó algo de una sesión offline).
if (typeof window !== "undefined") {
  window.addEventListener("online", flush);
  setTimeout(flush, 1500);
}

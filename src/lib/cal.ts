// Calendar navigation date-math for the Agenda (weekly scheduler). Pure, synchronous.
// The heavy grid/event layout lives in the AgendaCalendario bridge; the store only
// needs "what's today" and "move the anchor by one day/week/month".
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toISO(d: Date): string {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

// Parse a YYYY-MM-DD string as a LOCAL date at noon (avoids TZ/DST edge shifts).
function parseISO(s: string): Date {
  if (!s) return new Date();
  const a = s.split("-");
  return new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2]), 12, 0, 0);
}

export function todayISO(): string {
  return toISO(new Date());
}

// Move the anchor by one unit in the current view: day / week (7d) / month.
export function shift(anchor: string, view: string, dir: number): string {
  const d = parseISO(anchor || todayISO());
  if (view === "mes") d.setMonth(d.getMonth() + dir);
  else if (view === "dia") d.setDate(d.getDate() + dir);
  else d.setDate(d.getDate() + 7 * dir);
  return toISO(d);
}

// Broadcast the current calendar nav (anchor/view/sel) to the AgendaCalendario bridge.
// Called from a store `effect`, so it re-fires whenever nav state changes → the bridge
// re-reads the visible range. Also caches the latest on globalThis so a bridge that
// mounts later (when the Agenda tab opens) can pick up the current position immediately.
export function pushCal(anchor: string, view: string, sel: string): void {
  if (typeof window === "undefined") return;
  const payload = { anchor: anchor || todayISO(), view: view || "semana", sel: sel || anchor || todayISO() };
  (globalThis as unknown as { __calNav?: typeof payload }).__calNav = payload;
  window.dispatchEvent(new CustomEvent("cal:nav", { detail: payload }));
}

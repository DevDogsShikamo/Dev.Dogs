// Data write side-effects (fire-and-forget) callable from Muten actions.
// Each persists to Supabase, then dispatches "supa:refresh" so the SupaData
// bridge re-reads the affected tables and updates the stores reactively.
import { supa } from "./authActions";

function refresh(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("supa:refresh"));
  }
}

export function setServicioActivo(id: string, activo: boolean): void {
  supa.from("servicios").update({ activo }).eq("id", id).then(refresh);
}

export function persistPagado(id: string): void {
  supa.from("citas").update({ pagado: true }).eq("id", id).then(refresh);
}

export function persistHecho(id: string): void {
  supa.from("citas").update({ hecho: true }).eq("id", id).then(refresh);
}

export function saveEmpresa(row: Record<string, unknown>): void {
  supa.auth.getUser().then(function (res) {
    const uid = res.data.user && res.data.user.id;
    if (!uid) return;
    supa
      .from("empresa")
      .upsert({ ...row, owner_id: uid }, { onConflict: "owner_id" })
      .then(refresh);
  });
}

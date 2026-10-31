// Exportar el estado de cuenta/registro de un perro a CSV y Excel. Llamadas como side-effect
// desde acciones Muten. Toma la verdad de Supabase (todas las prestaciones del perro),
// arma la tabla y dispara una descarga del navegador (app real; no en artifacts).
// El separador es ";" porque en Colombia la coma es decimal (Excel lo parsea bien).
import { mesLabel, resolveSesion, supa, toast } from "./authActions";
import { pageAll } from "./localData.js";

type Fila = { fecha: string; servicio: string; estado: string; precio: number; cobrable: boolean; cobrado: boolean };

function slug(s: string): string {
  return (s || "perro").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "perro";
}

function bajar(nombre: string, mime: string, contenido: BlobPart): void {
  try {
    const url = URL.createObjectURL(new Blob([contenido], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    toast("No se pudo descargar");
  }
}

// A monthly charge (detalle.mensualidad = "YYYY-MM") reads "Mensualidad Paseo · Octubre 2026".
export function servicioLabel(servicio: string, detalle: unknown): string {
  const mes = (detalle as { mensualidad?: string } | null)?.mensualidad;
  return mes ? "Mensualidad " + servicio + " · " + mesLabel(mes) : servicio;
}

// Trae todas las prestaciones del perro (RLS: el dueño ve las de su perro), past the 1000-row cap.
function traerFilas(perroId: string): Promise<Fila[]> {
  return pageAll(() => supa
    .from("prestaciones")
    .select("fecha,estado,tipo,detalle,cobros(precio_aplicado,cobrable,cobrado),servicios(nombre)")
    .eq("perro_id", perroId)
    .order("fecha")
    .order("id"))
    .then((res: { data?: unknown[] | null }) => {
      const rows = (res.data || []) as Record<string, unknown>[];
      return rows.map((r): Fila => {
        const cb = (r.cobros as { precio_aplicado?: number; cobrable?: boolean; cobrado?: boolean } | null) || {};
        const cobrable = cb.cobrable !== false;
        const svc = (r.servicios as { nombre?: string } | null) || {};
        return {
          fecha: (r.fecha as string) || "",
          servicio: servicioLabel(svc.nombre || (r.tipo as string) || "", r.detalle),
          estado: (r.estado as string) || "",
          precio: cobrable ? (cb.precio_aplicado || 0) : 0,
          cobrable,
          cobrado: !!cb.cobrado,
        };
      });
    });
}

const CABECERA = ["Fecha", "Servicio", "Estado", "Precio", "Cobrado"];
// No es una factura electrónica DIAN: la leyenda va en cada archivo exportado.
const LEYENDA = "Este documento no es una factura electrónica.";

function valores(f: Fila): (string | number)[] {
  return [f.fecha, f.servicio, f.estado, f.cobrable ? f.precio : 0, f.cobrado ? "Sí" : "No"];
}

// Total = solo paseos realizados (finalizados) y cobrables — es lo que se cobra.
function total(filas: Fila[]): number {
  return filas.reduce((acc, f) => acc + (f.cobrable && f.estado === "finalizado" ? f.precio : 0), 0);
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function descargarEstadoCuentaCSV(perroId: string, perroNombre: string): void {
  if (!perroId) return;
  traerFilas(perroId).then((filas) => {
    const lineas = [CABECERA.join(";")];
    filas.forEach((f) => lineas.push(valores(f).map(csvEscape).join(";")));
    lineas.push("");
    lineas.push(["TOTAL", "", "", total(filas), ""].map(csvEscape).join(";"));
    lineas.push("");
    lineas.push(csvEscape(LEYENDA));
    // BOM para que Excel lea bien los acentos.
    bajar("estado-de-cuenta-" + slug(perroNombre) + ".csv", "text/csv;charset=utf-8", "﻿" + lineas.join("\r\n"));
    toast("Estado de cuenta CSV descargado");
  });
}

export function descargarEstadoCuentaExcel(perroId: string, perroNombre: string): void {
  if (!perroId) return;
  traerFilas(perroId).then((filas) => {
    // xlsx se carga sólo al exportar (chunk aparte, no infla el bundle inicial).
    import("xlsx")
      .then((XLSX) => {
        const aoa: (string | number)[][] = [
          ["Estado de cuenta — " + (perroNombre || "Perro")],
          [LEYENDA],
          [],
          CABECERA,
          ...filas.map(valores),
          [],
          ["TOTAL", "", "", total(filas), ""],
        ];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Estado de cuenta");
        const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
        bajar(
          "estado-de-cuenta-" + slug(perroNombre) + ".xlsx",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          out,
        );
        toast("Estado de cuenta Excel descargado");
      })
      .catch(() => toast("No se pudo generar el Excel"));
  });
}

// ---- "Exportar mes" (Reportes: owner or finance office) -------------------------------------------------
// The charges of one month ("YYYY-MM") of the caller's business: finished, chargeable services, monthly charges
// included. RLS on `cobros` gives them only to the owner and the finance office.
// Every row of the month (pageAll, past the 1000-row cap).
type FilaMes = { fecha: string; perro: string; cliente: string; servicio: string; monto: number; pagado: boolean };
const CABECERA_MES = ["Fecha", "Perro", "Cliente", "Servicio", "Monto", "Estado"];

function traerMes(mes: string): Promise<FilaMes[]> {
  const [y, m] = mes.split("-").map(Number);
  const desde = mes + "-01";
  const hasta = mes + "-" + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0");
  return resolveSesion().then((s) => Promise.all([
    pageAll(() => supa.rpc("perro_duenos_nombres").order("perro_id").order("nombre")),
    pageAll(() => supa.from("cobros")
      .select("precio_aplicado,cobrado,prestaciones!inner(fecha,estado,tipo,detalle,perro_id,perros(nombre),servicios(nombre))")
      .eq("negocio_id", s.negocioId).eq("cobrable", true).eq("prestaciones.estado", "finalizado")
      .gte("prestaciones.fecha", desde).lte("prestaciones.fecha", hasta).order("prestacion_id")),
  ])).then(([dr, cr]: { data?: unknown[] | null }[]) => {
    const duenos: Record<string, string> = {};
    ((dr.data || []) as { perro_id: string; nombre: string }[]).forEach((d) => { duenos[d.perro_id] = d.nombre || ""; });
    return ((cr.data || []) as Record<string, unknown>[]).map((c): FilaMes => {
      const p = (c.prestaciones || {}) as Record<string, unknown>;
      const svc = (p.servicios as { nombre?: string } | null) || {};
      return {
        fecha: (p.fecha as string) || "",
        perro: ((p.perros as { nombre?: string } | null) || {}).nombre || "",
        cliente: duenos[p.perro_id as string] || "",
        servicio: servicioLabel(svc.nombre || (p.tipo as string) || "", p.detalle),
        monto: (c.precio_aplicado as number) || 0,
        pagado: !!c.cobrado,
      };
    }).sort((a, b) => (a.fecha + a.perro).localeCompare(b.fecha + b.perro));
  });
}

function valoresMes(f: FilaMes): (string | number)[] {
  return [f.fecha, f.perro, f.cliente, f.servicio, f.monto, f.pagado ? "Pagado" : "Pendiente"];
}
const totalMes = (filas: FilaMes[]) => filas.reduce((acc, f) => acc + f.monto, 0);
// The picked month, or the current one (device clock, like the Reportes bridge) before the months are listed.
function mesOActual(m: string): string {
  if (/^\d{4}-\d{2}$/.test(m || "")) return m;
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

export function exportarMesCSV(m: string): void {
  const mes = mesOActual(m);
  traerMes(mes).then((filas) => {
    const lineas = [CABECERA_MES.join(";")];
    filas.forEach((f) => lineas.push(valoresMes(f).map(csvEscape).join(";")));
    lineas.push("");
    lineas.push(["TOTAL", "", "", "", totalMes(filas), ""].map(csvEscape).join(";"));
    lineas.push("");
    lineas.push(csvEscape(LEYENDA));
    bajar("cobros-" + mes + ".csv", "text/csv;charset=utf-8", "﻿" + lineas.join("\r\n"));
    toast("Cobros del mes descargados (CSV)");
  });
}

export function exportarMesExcel(m: string): void {
  const mes = mesOActual(m);
  traerMes(mes).then((filas) => {
    import("xlsx")
      .then((XLSX) => {
        const aoa: (string | number)[][] = [
          ["Cobros de " + mesLabel(mes)],
          [LEYENDA],
          [],
          CABECERA_MES,
          ...filas.map(valoresMes),
          [],
          ["TOTAL", "", "", "", totalMes(filas), ""],
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Cobros");
        bajar("cobros-" + mes + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          XLSX.write(wb, { bookType: "xlsx", type: "array" }));
        toast("Cobros del mes descargados (Excel)");
      })
      .catch(() => toast("No se pudo generar el Excel"));
  });
}

// "Descargar mis datos": the JSON mis_datos_exportar() returns (only the caller's own personal data).
export function misDatosDescargar(): void {
  supa.rpc("mis_datos_exportar").then((res: { data?: unknown; error?: unknown }) => {
    if (res.error) { toast("No se pudieron descargar tus datos"); return; }
    bajar("mis-datos-devdogs.json", "application/json;charset=utf-8", JSON.stringify(res.data, null, 2));
    toast("Tus datos se descargaron");
  });
}

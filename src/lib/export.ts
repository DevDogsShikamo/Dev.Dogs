// Exportar el estado de cuenta/registro de un perro a CSV y Excel. Llamadas como side-effect
// desde acciones Muten. Toma la verdad de Supabase (todas las prestaciones del perro),
// arma la tabla y dispara una descarga del navegador (app real; no en artifacts).
// El separador es ";" porque en Colombia la coma es decimal (Excel lo parsea bien).
import { supa, toast } from "./authActions";

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

// Trae todas las prestaciones del perro (RLS: el dueño ve las de su perro).
function traerFilas(perroId: string): Promise<Fila[]> {
  return supa
    .from("prestaciones")
    .select("fecha,estado,tipo,cobros(precio_aplicado,cobrable,cobrado),servicios(nombre)")
    .eq("perro_id", perroId)
    .order("fecha")
    .then((res: { data?: unknown[] | null }) => {
      const rows = (res.data || []) as Record<string, unknown>[];
      return rows.map((r): Fila => {
        const cb = (r.cobros as { precio_aplicado?: number; cobrable?: boolean; cobrado?: boolean } | null) || {};
        const cobrable = cb.cobrable !== false;
        const svc = (r.servicios as { nombre?: string } | null) || {};
        return {
          fecha: (r.fecha as string) || "",
          servicio: svc.nombre || (r.tipo as string) || "",
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

// "Descargar mis datos": the JSON mis_datos_exportar() returns (only the caller's own personal data).
export function misDatosDescargar(): void {
  supa.rpc("mis_datos_exportar").then((res: { data?: unknown; error?: unknown }) => {
    if (res.error) { toast("No se pudieron descargar tus datos"); return; }
    bajar("mis-datos-devdogs.json", "application/json;charset=utf-8", JSON.stringify(res.data, null, 2));
    toast("Tus datos se descargaron");
  });
}

// Spanish label for a state code stored in the DB (prestaciones and resenas check constraints).
// The raw code stays in the data and in CSS classes; only what the user reads goes through here.
const LABELS = {
  programado: "Programado",
  recibido: "Recibido",
  en_curso: "En curso",
  finalizado: "Finalizado",
  no_asistio: "No asistió",
  cancelado: "Cancelado",
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
};

export function estadoLabel(code) {
  return LABELS[code] || code || "";
}

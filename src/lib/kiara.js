// Ley 2480 de 2025 (Ley Kiara) art. 9.3: the health certificate is valid six calendar months from its
// issue date (perros.certificado_salud), inclusive of the last day, counted on the Bogotá calendar.
// It only warns; the server never blocks a walk for it. `hoy` (YYYY-MM-DD) is injectable for tests.
function hoyBogota() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

function pad(n) {
  return String(n).padStart(2, "0");
}

// Last valid day (YYYY-MM-DD), or "" without a date. Aug 31 + 6 months clamps to Feb 28/29.
export function venceCertificado(fecha) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha || "");
  if (!m) return "";
  let y = +m[1], mo = +m[2] + 6;
  if (mo > 12) { mo -= 12; y++; }
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return y + "-" + pad(mo) + "-" + pad(Math.min(+m[3], last));
}

export function certificadoVigente(fecha, hoy) {
  const v = venceCertificado(fecha);
  return !!v && (hoy || hoyBogota()) <= v;
}

export function estadoCertificado(fecha, hoy) {
  const v = venceCertificado(fecha);
  if (!v) return "Sin certificado de salud";
  if ((hoy || hoyBogota()) > v) return "Certificado de salud vencido";
  return "Certificado de salud vigente hasta " + v.slice(8) + "/" + v.slice(5, 7) + "/" + v.slice(0, 4);
}

// Clipboard + invitation-link helpers. Called as side-effect statements from Muten
// actions (copiar códigos/links) and a page effect (prefill /unirse from the URL).
// Feedback reuses the same "toast" window event that Toast.js listens for.
import { toast } from "./authActions";

function write(text: string): void {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toast("Copiado ✓"),
        () => toast("No se pudo copiar"),
      );
    } else {
      toast("No se pudo copiar");
    }
  } catch {
    toast("No se pudo copiar");
  }
}

// Link con el código precargado: el invitado lo abre y solo pone correo + contraseña.
export function inviteLink(codigo: string): string {
  const c = encodeURIComponent((codigo || "").trim());
  try {
    return location.origin + "/unirse?codigo=" + c;
  } catch {
    return "/unirse?codigo=" + c;
  }
}

export function copiarCodigo(codigo: string): void {
  write((codigo || "").trim());
}

export function copiarLink(codigo: string): void {
  write(inviteLink(codigo));
}

// Lee ?codigo=XXX de la URL (para precargar el campo en /unirse). "" si no hay.
export function codigoDeURL(): string {
  try {
    return new URLSearchParams(location.search).get("codigo") || "";
  } catch {
    return "";
  }
}

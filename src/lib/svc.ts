// Etiqueta legible del tipo de servicio (la lista muestra el tipo crudo si no).
const LABELS: Record<string, string> = {
  paseo: "Paseo",
  guarderia: "Guardería",
  bano: "Baño",
  corte: "Corte de garras",
  adiestramiento: "Adiestramiento",
  veterinaria: "Veterinaria",
  comida: "Comida",
  accesorio: "Snack/Accesorio",
};

export function tipoLabel(tipo: string): string {
  return LABELS[tipo] || tipo || "";
}

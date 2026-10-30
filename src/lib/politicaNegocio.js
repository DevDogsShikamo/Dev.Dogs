// Policies each business publishes for its clients (negocio_politicas, 20261022110001_politicas_negocio.sql).
// The sections are fixed (clave + title); requisitos and responsabilidad are required because they carry what
// the Ley 2480 de 2025 (arts. 11 and 14) asks the service contract to settle. The limits mirror
// negocio_politica_publicar, which validates again on the server. A business with no policy yet starts from
// these examples, marked with EJEMPLO so they are never published unadapted.
const EJEMPLO = "Ejemplo, edítalo según tu negocio: ";

const SECCIONES = [
  { clave: "servicios", titulo: "Servicios que prestamos", req: false,
    ejemplo: "Paseos en grupo de máximo ocho (8) perros por paseador, de 60 minutos, de lunes a viernes, y guardería de 7:00 a 18:00. Las zonas y los horarios de cada salida los ves al reservar." },
  { clave: "recogida", titulo: "Recogida y entrega", req: false,
    ejemplo: "Recogemos y entregamos a tu perro en la dirección acordada, con un margen de 15 minutos. Si al entregarlo no hay nadie para recibirlo, te llamamos y lo seguimos cuidando hasta que alguien pueda recibirlo." },
  { clave: "cancelaciones", titulo: "Cancelaciones y reprogramaciones", req: false,
    ejemplo: "Puedes cancelar o reprogramar sin costo si nos avisas con al menos 12 horas de anticipación. Si cancelamos nosotros, reprogramamos el servicio o no lo cobramos." },
  { clave: "pagos", titulo: "Precios y pagos", req: false,
    ejemplo: "Los precios son los del catálogo de la aplicación. Pagas por transferencia o en efectivo al final de cada mes, solo por los servicios realizados. Si tu perro tiene un plan mensual, pagas el precio fijo del mes aunque falte a algún paseo; si lo cancelas, termina al final del mes en curso." },
  { clave: "requisitos", titulo: "Requisitos para tu perro", req: true,
    ejemplo: "Tu perro debe tener al día el carné de vacunación, la desparasitación y el certificado de salud expedido por un médico veterinario. Cuéntanos su estado de salud, cómo se comporta con otros perros y con las personas, y cualquier cuidado especial que necesite. Una hembra en celo no sale a paseo ni a guardería." },
  { clave: "responsabilidad", titulo: "Responsabilidad, incidentes y emergencias", req: true,
    ejemplo: "Durante el servicio respondemos por el cuidado de tu perro. El daño que un perro cause a otro lo responde el dueño del perro que lo causó (artículo 2353 del Código Civil), salvo que resulte de falta de cuidado o de supervisión de nuestra parte. Si hay un incidente, te avisamos de inmediato por teléfono y te contamos qué pasó. En una emergencia, si no logramos comunicarnos contigo, autorizas que llevemos a tu perro al veterinario que nos indicaste o al más cercano; [indica quién asume esos gastos]. [Si tienes un seguro de responsabilidad civil, indica cuál y qué cubre.]" },
  { clave: "fotos", titulo: "Fotos del servicio", req: false,
    ejemplo: "Durante el servicio podemos tomar fotos de tu perro para que las veas en la aplicación. No las usamos con otro fin sin tu autorización." },
  { clave: "retracto", titulo: "Derecho de retracto", req: false,
    ejemplo: "Si contratas un plan por la aplicación, puedes retractarte dentro de los cinco (5) días hábiles siguientes, salvo que el servicio ya haya empezado con tu acuerdo (artículo 47 de la Ley 1480 de 2011)." },
  { clave: "otras", titulo: "Otras condiciones", req: false,
    ejemplo: "Escribe aquí cualquier otra condición de tu servicio, o deja este espacio vacío." },
];

const MAX_TEXTO = 4000;
const MAX_TOTAL = 30000;

// The editor rows (one per section, id = clave): the published text of each section, or, when the business
// has published nothing yet, the examples.
export function politicaEditable(publicadas) {
  const list = publicadas || [];
  return SECCIONES.map(function (s) {
    const p = list.find(function (x) { return x.clave === s.clave; });
    return { id: s.clave, clave: s.clave, titulo: s.titulo, req: s.req, texto: p ? p.texto : list.length ? "" : EJEMPLO + s.ejemplo };
  });
}

// "" when the rows can be published, else what to fix (the same rules as the server, plus the example mark).
export function politicaError(rows) {
  const list = rows || [];
  const texto = function (r) { return String(r.texto || "").trim(); };
  if (list.some(function (r) { return r.req && !texto(r); })) return "Las secciones Requisitos para tu perro y Responsabilidad, incidentes y emergencias son obligatorias.";
  if (list.some(function (r) { return texto(r).indexOf(EJEMPLO.trim()) === 0; })) return "Adapta los textos de ejemplo a tu negocio y borra la marca «Ejemplo, edítalo según tu negocio:» antes de publicar.";
  if (list.some(function (r) { return texto(r).length > MAX_TEXTO; })) return "Cada sección admite hasta 4000 caracteres.";
  if (list.reduce(function (n, r) { return n + texto(r).length; }, 0) > MAX_TOTAL) return "Las políticas admiten hasta 30000 caracteres en total.";
  return "";
}

// The payload of negocio_politica_publicar: the required sections and every optional one with text.
export function politicaPayload(rows) {
  return (rows || [])
    .filter(function (r) { return r.req || String(r.texto || "").trim(); })
    .map(function (r) { return { clave: r.clave, titulo: r.titulo, texto: String(r.texto || "").trim() }; });
}

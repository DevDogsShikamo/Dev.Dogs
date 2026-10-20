// i18n del panel — diccionario ANIDADO ES/EN. Se accede como i18n.d.nav.inicio
// (member access reactivo: i18n.d = dict(lang), y lang es state persist del store).
// Para los Custom (vanilla JS) se publica el idioma en globalThis.__lang + evento "lang:changed".
const ES = {
  nav: { menu: "Menú", inicio: "Inicio", agenda: "Agenda", grupos: "Grupos", perros: "Perros", perfil: "Perfil" },
  rol: { paseador: "Paseador" },
  dash: { saludo: "Buen día 👋", tenes: "Tenés", gruposW: "grupos", h1b: "para hoy", perrosHoy: "perros hoy", proximo: "Próximo grupo", sinHoy: "Sin grupos para hoy" },
  ag: { dia: "Día", semana: "Semana", mes: "Mes", hoy: "Hoy", titulo: "Agenda de paseos", misServicios: "Mis servicios", categorias: "Categorías" },
  svc: { paseos: "Paseos", guarderia: "Guardería", veterinaria: "Veterinaria", descanso: "Descanso", adiestramiento: "Adiestramiento" },
  ficha: { perrosGrupo: "Perros del grupo", perros: "perros" },
  gr: { grupos: "Grupos", hoy: "Grupos de hoy", timeline: "Timeline", organizar: "Organizar", sinHoy: "Sin grupos hoy", sinHoySub: "No tenés grupos programados para hoy.", hintPerro: "Arrastrá un perro a otro grupo, o arrastrá un grupo (por su cabecera) a otra franja horaria." },
  pr: { titulo: "Perros", agregar: "Agregar", sin: "Sin perros todavía", sinSub: "Agregá tu primer perro con el botón de arriba.", datos: "Datos del perro", guardar: "Guardar", buscar: "Buscar por nombre o raza", desc: "Descripción", sinResultados: "Ningún perro coincide con tu búsqueda", editar: "Editar", relaciones: "Cómo se lleva con otros perros", sinRel: "Sin relaciones marcadas", agregarRel: "Agregar relación", elegirPerro: "¿Con qué perro?", nivel: "Nivel", nota: "Nota (opcional)", notaPh: "Ej. se toleran pero no cerca de la comida", guardarRel: "Guardar relación", relHint: "Las relaciones con otros perros se agregan desde la ficha del perro.", relWalkHint: "Marcá según cómo se comportan EN EL PASEO (con vos), no en casa." },
  rel: { cuidado: "Con cuidado", tolera: "Se toleran en paseo", no_tolera: "No se pueden ni ver" },
  mot: { titulo: "Motivo (opcional)", agresion: "Agresión", reactividad: "Reactividad", tamano: "Tamaño/energía", celos: "Celos/recursos", celo: "Celo" },
  soc: { titulo: "Con otros perros", excelente: "Excelente con otros", bueno: "Bueno con otros", cuidado: "Con cuidado", selectivo: "Selectivo", sinDef: "Sin definir" },
  al: { titulo: "Alertas de compatibilidad", ninguna: "Sin conflictos en los grupos de hoy ✓", juntos: "juntos en", ver: "Ver ficha", hoy: "conflictos hoy" },
  pf: { gruposHoy: "Grupos hoy", perrosCargo: "Perros a cargo", gruposAct: "Grupos activos", miHorario: "Mi horario", servicios: "Servicios y precios", grupos: "Mis grupos", editar: "Editar perfil", notif: "Notificaciones", ayuda: "Ayuda y soporte", salir: "Cerrar sesión" },
  fp: { titulo: "Ficha del perro", raza: "Raza", tamano: "Tamaño", tips: "Notas", sinDatos: "Sin datos adicionales" },
  sv: { titulo: "Servicios y precios", agregar: "Agregar", sin: "Sin servicios todavía", sinSub: "Creá tu primer servicio con su precio.", datos: "Datos del servicio", guardar: "Guardar", min: "min", mensual: "/mes" },
  gp: { titulo: "Mis grupos", agregar: "Agregar", sin: "Sin grupos todavía", sinSub: "Creá tu primera salida (zona + hora).", datos: "Datos del grupo", nombre: "Nombre", zona: "Zona", hora: "Hora de salida", duracion: "Duración (min)", servicio: "Servicio", color: "Color", guardar: "Guardar grupo", min: "min", sinServicio: "Sin servicio", sinZonas: "Definí zonas en Servicios" },
  zn: { titulo: "Zonas donde trabajás", sin: "Sin zonas definidas todavía", placeholder: "Nueva zona (ej. Chapinero)", agregar: "Agregar" },
  va: { boton: "Descanso", titulo: "Descanso / Vacaciones", desde: "Desde", hasta: "Hasta", nota: "Nota (opcional)", notaPh: "Ej. Vacaciones", agregar: "Agregar descanso", actuales: "Descansos programados", descanso: "Descanso" },
  ho: { titulo: "Mi horario", intro: "Elegí tus días de trabajo y tus franjas horarias.", dias: "Días de trabajo", f1: "Franja 1 (mañana)", f2: "Segunda franja (tarde)", guardar: "Guardar horario", ok: "✓ Horario guardado", a: "a" },
  day: { lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom" },
  d2: { lun: "Lu", mar: "Ma", mie: "Mi", jue: "Ju", vie: "Vi", sab: "Sá", dom: "Do" },
};

const EN = {
  nav: { menu: "Menu", inicio: "Home", agenda: "Schedule", grupos: "Groups", perros: "Dogs", perfil: "Profile" },
  rol: { paseador: "Walker" },
  dash: { saludo: "Good morning 👋", tenes: "You have", gruposW: "groups", h1b: "today", perrosHoy: "dogs today", proximo: "Next group", sinHoy: "No groups today" },
  ag: { dia: "Day", semana: "Week", mes: "Month", hoy: "Today", titulo: "Walk schedule", misServicios: "My services", categorias: "Categories" },
  svc: { paseos: "Walks", guarderia: "Daycare", veterinaria: "Vet", descanso: "Break", adiestramiento: "Training" },
  ficha: { perrosGrupo: "Dogs in the group", perros: "dogs" },
  gr: { grupos: "Groups", hoy: "Today's groups", timeline: "Timeline", organizar: "Organize", sinHoy: "No groups today", sinHoySub: "You have no groups scheduled for today.", hintPerro: "Drag a dog to another group, or drag a group (by its header) to another time slot." },
  pr: { titulo: "Dogs", agregar: "Add", sin: "No dogs yet", sinSub: "Add your first dog with the button above.", datos: "Dog details", guardar: "Save", buscar: "Search by name or breed", desc: "Description", sinResultados: "No dog matches your search", editar: "Edit", relaciones: "How they get along with other dogs", sinRel: "No relationships marked", agregarRel: "Add relationship", elegirPerro: "With which dog?", nivel: "Level", nota: "Note (optional)", notaPh: "e.g. they tolerate each other but not near food", guardarRel: "Save relationship", relHint: "Relationships with other dogs are added from the dog's profile.", relWalkHint: "Mark based on how they behave ON THE WALK (with you), not at home." },
  rel: { cuidado: "With care", tolera: "Tolerate on walks", no_tolera: "Can't stand each other" },
  mot: { titulo: "Reason (optional)", agresion: "Aggression", reactividad: "Reactivity", tamano: "Size/energy", celos: "Resource guarding", celo: "In heat" },
  soc: { titulo: "With other dogs", excelente: "Great with others", bueno: "Good with others", cuidado: "Needs care", selectivo: "Selective", sinDef: "Not set" },
  al: { titulo: "Compatibility alerts", ninguna: "No conflicts in today's groups ✓", juntos: "together in", ver: "View profile", hoy: "conflicts today" },
  pf: { gruposHoy: "Groups today", perrosCargo: "Dogs in care", gruposAct: "Active groups", miHorario: "My schedule", servicios: "Services & prices", grupos: "My groups", editar: "Edit profile", notif: "Notifications", ayuda: "Help & support", salir: "Log out" },
  fp: { titulo: "Dog profile", raza: "Breed", tamano: "Size", tips: "Notes", sinDatos: "No extra details" },
  sv: { titulo: "Services & prices", agregar: "Add", sin: "No services yet", sinSub: "Create your first priced service.", datos: "Service details", guardar: "Save", min: "min", mensual: "/mo" },
  gp: { titulo: "My groups", agregar: "Add", sin: "No groups yet", sinSub: "Create your first departure (zone + time).", datos: "Group details", nombre: "Name", zona: "Zone", hora: "Departure time", duracion: "Duration (min)", servicio: "Service", color: "Color", guardar: "Save group", min: "min", sinServicio: "No service", sinZonas: "Define zones in Services" },
  zn: { titulo: "Zones you work in", sin: "No zones defined yet", placeholder: "New zone (e.g. Downtown)", agregar: "Add" },
  va: { boton: "Time off", titulo: "Time off / Vacation", desde: "From", hasta: "To", nota: "Note (optional)", notaPh: "e.g. Vacation", agregar: "Add time off", actuales: "Scheduled time off", descanso: "Off" },
  ho: { titulo: "My schedule", intro: "Pick your working days and time slots.", dias: "Working days", f1: "Slot 1 (morning)", f2: "Second slot (afternoon)", guardar: "Save schedule", ok: "✓ Schedule saved", a: "to" },
  day: { lun: "Mon", mar: "Tue", mie: "Wed", jue: "Thu", vie: "Fri", sab: "Sat", dom: "Sun" },
  d2: { lun: "Mo", mar: "Tu", mie: "We", jue: "Th", vie: "Fr", sab: "Sa", dom: "Su" },
};

export function dict(lang: string) {
  return lang === "en" ? EN : ES;
}

// Publica el idioma para los componentes Custom (vanilla JS).
export function pushLang(lang: string): void {
  if (typeof window === "undefined") return;
  (globalThis as unknown as { __lang?: string }).__lang = lang;
  window.dispatchEvent(new CustomEvent("lang:changed", { detail: lang }));
}

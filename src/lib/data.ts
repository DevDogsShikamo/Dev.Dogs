// Data write side-effects (fire-and-forget) callable from Muten actions.
// Each persists to Supabase, then dispatches "supa:refresh" so the read bridges
// (DataBootstrap, etc.) re-read and update the stores reactively.
import { supa, toast, resolveSesion } from "./authActions";
import { rpcOrQueue } from "./outbox";
import { copiarCodigo } from "./share";

function refresh(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("supa:refresh"));
  }
}

// Handler de .then para escrituras: en ERROR avisa (toast) + revierte (refresh);
// en ÉXITO corre onOk (por defecto nada — el patch optimista ya refleja el cambio;
// pasar `refresh` cuando la escritura NO es optimista y hay que traer la verdad).
function done(msg: string, onOk?: () => void) {
  return function (res?: unknown): void {
    if (res && (res as { error?: unknown }).error) { toast(msg); refresh(); return; }
    if (onOk) onOk();
  };
}

// ---- Catálogo de perros (schema v3) --------------------------------------
// Alta: resuelve el negocio del usuario (por su profile) y luego inserta el perro.
// tamano debe ser pequeno|mediano|grande o null (check constraint).
type PerroInput = { nombre?: string; raza?: string; tamano?: string; conducta?: string; tips?: string; foto?: string; sociabilidad?: string };

function perroFields(p: PerroInput): Record<string, unknown> {
  return {
    nombre: p.nombre || "",
    raza: p.raza || null,
    tamano: p.tamano ? p.tamano : null,
    conducta: p.conducta || null,
    tips: p.tips || null,
    foto_url: p.foto || null,
    sociabilidad: p.sociabilidad ? p.sociabilidad : null,
  };
}

export function perroCrear(p: PerroInput): void {
  resolveSesion().then(function (s) {
    if (!s.negocioId) return;
    supa.from("perros").insert({ negocio_id: s.negocioId, ...perroFields(p) }).then(function (res) {
      // Alta no es optimista (id lo genera el server): éxito → refresh trae la fila real.
      if (res && (res as { error?: unknown }).error) { toast("No se pudo agregar el perro"); return; }
      refresh();
    });
  });
}

// Edición OPTIMISTA: el store ya se patcheó en la acción; en éxito no refrescamos
// (evita recargar todo), y solo si falla revertimos con refresh + toast.
export function perroActualizar(id: string, p: PerroInput): void {
  supa.from("perros").update(perroFields(p)).eq("id", id).then(function (res) {
    if (res && (res as { error?: unknown }).error) { toast("No se pudo guardar el perro"); refresh(); }
  });
}

// Borrado OPTIMISTA (ya se quitó del store). El RPC (solo el jefe) da de baja el perro sin
// perder su historial y limpia agenda futura, grupos y relaciones de los demás; el refresh
// reconcilia el conteo. Si falla, el refresh revierte.
export function perroEliminar(id: string): void {
  supa.rpc("perro_eliminar", { p_id: id }).then(function (res) {
    if (res && (res as { error?: unknown }).error) toast("No se pudo eliminar el perro");
    refresh();
  });
}

// Co-dueños (solo el jefe): el RPC valida que el perro y el cliente sean del negocio.
export function coduenioAgregar(perroId: string, duenoId: string): void {
  if (!perroId || !duenoId) return;
  supa.rpc("coduenio_agregar", { p_perro: perroId, p_dueno: duenoId }).then(done("No se pudo agregar el co-dueño", refresh));
}
export function coduenioQuitar(perroId: string, duenoId: string): void {
  if (!perroId || !duenoId) return;
  supa.rpc("coduenio_quitar", { p_perro: perroId, p_dueno: duenoId }).then(done("No se pudo quitar el co-dueño", refresh));
}

// ---- Relaciones entre perros (perros.incompatibles jsonb) -----------------
// Cada entrada: { id, nivel: 'cuidado'|'tolera'|'no_tolera', nota, motivo }. Simétrica.
// motivo: 'agresion'|'reactividad'|'tamano'|'celos'|'celo' (o "" sin definir).
type RelEntry = { id: string; nivel: string; nota: string; motivo?: string };

// Reemplaza (o elimina, si nivel === "") la relación de `dog` hacia `other`.
function relPut(dog: string, other: string, nivel: string, nota: string, motivo: string, done: () => void): void {
  supa.from("perros").select("incompatibles").eq("id", dog).single().then(function (res) {
    let lst: RelEntry[] = ((res.data && (res.data as { incompatibles?: RelEntry[] }).incompatibles) || []).slice();
    lst = lst.filter(function (e) { return e && e.id !== other; });
    if (nivel) lst.push({ id: other, nivel: nivel, nota: nota || "", motivo: motivo || "" });
    supa.from("perros").update({ incompatibles: lst }).eq("id", dog).then(done);
  });
}

// Fija una relación entre A y B (mismo nivel+nota+motivo en ambos extremos).
export function relacionSet(a: string, b: string, nivel: string, nota: string, motivo: string): void {
  if (!a || !b || a === b) return;
  const lvl = nivel || "cuidado";
  relPut(a, b, lvl, nota || "", motivo || "", function () { relPut(b, a, lvl, nota || "", motivo || "", done("No se pudo actualizar la relación", refresh)); });
}

// Elimina la relación entre A y B en ambos extremos.
export function relacionQuitar(a: string, b: string): void {
  if (!a || !b) return;
  relPut(a, b, "", "", "", function () { relPut(b, a, "", "", "", done("No se pudo actualizar la relación", refresh)); });
}

// ---- Servicios + precios del paseador (schema v3) -------------------------
// El paseador define su oferta: tipo, nombre, duración y precio (por uso o mensual).
type ServicioInput = { nombre?: string; tipo?: string; duracion?: number; precio?: number; modelo?: string };

function servicioFields(s: ServicioInput): Record<string, unknown> {
  const mensual = s.modelo === "mensual";
  return {
    nombre: s.nombre || "",
    tipo: s.tipo || "paseo",
    duracion_min: s.duracion || 0,
    modelo_cobro: mensual ? "mensual" : "por_uso",
    precio: mensual ? 0 : (s.precio || 0),
    precio_mensual: mensual ? (s.precio || 0) : 0,
  };
}

export function servicioCrear(s: ServicioInput): void {
  resolveSesion().then(function (sesion) {
    if (!sesion.negocioId) return;
    supa.from("servicios").insert({ negocio_id: sesion.negocioId, activo: true, ...servicioFields(s) }).then(done("No se pudo agregar el servicio", refresh));
  });
}

// Optimista (servicioUpd ya patcheó el store): éxito → nada; error → toast+revert.
export function servicioActualizar(id: string, s: ServicioInput): void {
  supa.from("servicios").update(servicioFields(s)).eq("id", id).then(done("No se pudo guardar el servicio"));
}

// Soft-delete OPTIMISTA (servicioDel ya lo quitó): éxito → nada; error → toast+revert.
export function servicioEliminar(id: string): void {
  supa.from("servicios").update({ activo: false }).eq("id", id).then(done("No se pudo eliminar el servicio"));
}

// ---- Zonas de trabajo del negocio (negocios.zonas jsonb) ------------------
export function zonaAgregar(nombre: string): void {
  if (!nombre) return;
  resolveSesion().then(function (s) {
    if (!s.negocioId) return;
    const neg = s.negocioId;
    supa.from("negocios").select("zonas").eq("id", neg).single().then(function (res) {
      const zonas: string[] = ((res.data && (res.data as { zonas?: string[] }).zonas) || []).slice();
      if (zonas.indexOf(nombre) < 0) zonas.push(nombre);
      supa.from("negocios").update({ zonas }).eq("id", neg).then(done("No se pudo actualizar las zonas"));
    });
  });
}

export function zonaQuitar(nombre: string): void {
  resolveSesion().then(function (s) {
    if (!s.negocioId) return;
    const neg = s.negocioId;
    supa.from("negocios").select("zonas").eq("id", neg).single().then(function (res) {
      const zonas: string[] = ((res.data && (res.data as { zonas?: string[] }).zonas) || []).filter(function (z) { return z !== nombre; });
      supa.from("negocios").update({ zonas }).eq("id", neg).then(done("No se pudo actualizar las zonas"));
    });
  });
}

// ---- ABM de grupos (salidas: zona + hora + duración + servicio) -----------
type GrupoInput = { nombre?: string; zona?: string; hora?: number; duracion?: number; servicio?: string; color?: string };

function grupoFields(g: GrupoInput): Record<string, unknown> {
  return {
    nombre: g.nombre || "",
    zona: g.zona || null,
    hora: hhmm(g.hora || 8),
    duracion_min: g.duracion || 60,
    servicio_id: g.servicio ? g.servicio : null,
    color: g.color || "purple",
  };
}

export function grupoCrear(nombre: string, zona: string, hora: number, duracion: number, servicio: string, color: string): void {
  const g: GrupoInput = { nombre, zona, hora, duracion, servicio, color };
  resolveSesion().then(function (s) {
    if (!s.uid || !s.negocioId) return;
    supa.from("grupos").insert({ negocio_id: s.negocioId, cuidador_id: s.uid, activo: true, ...grupoFields(g) }).then(done("No se pudo crear la salida", refresh));
  });
}

export function grupoActualizar(id: string, nombre: string, zona: string, hora: number, duracion: number, servicio: string, color: string): void {
  supa.from("grupos").update(grupoFields({ nombre, zona, hora, duracion, servicio, color })).eq("id", id).then(done("No se pudo guardar la salida", refresh));
}

// Optimista (grupoDel ya lo quitó): éxito → nada; error → toast+revert.
export function grupoEliminar(id: string): void {
  supa.from("grupos").update({ activo: false }).eq("id", id).then(done("No se pudo eliminar la salida"));
}

// ---- Drag & drop de grupos (RPCs en migration_grupos.sql) ----------------
// Mover un perro a otro grupo: modo 'siempre' (membresía recurrente + regenera)
// o 'hoy' (solo esa fecha).
export function moverPerro(perro: string, grupo: string, modo: string, fecha: string): void {
  supa.rpc("mover_perro", { p_perro: perro, p_grupo: grupo, p_modo: modo, p_fecha: fecha }).then(done("No se pudo mover el perro", refresh));
}

// Cambiar la hora de un grupo entero (arrastrarlo a otra franja).
export function grupoSetHora(grupo: string, hora: string, fecha: string): void {
  supa.rpc("grupo_set_hora", { p_grupo: grupo, p_hora: hora, p_fecha: fecha }).then(done("No se pudo cambiar la hora", refresh));
}

// ---- Vacaciones / descansos del paseador (profiles.vacaciones jsonb) ------
type Vaca = { desde: string; hasta: string; nota?: string };

export function vacacionAgregar(desde: string, hasta: string, nota: string): void {
  if (!desde || !hasta) return;
  supa.auth.getUser().then(function (u) {
    const uid = u.data.user && u.data.user.id;
    if (!uid) return;
    supa.from("profiles").select("vacaciones").eq("id", uid).single().then(function (res) {
      const v: Vaca[] = ((res.data && (res.data as { vacaciones?: Vaca[] }).vacaciones) || []).slice();
      v.push({ desde: desde, hasta: (hasta < desde ? desde : hasta), nota: nota || "" });
      supa.from("profiles").update({ vacaciones: v }).eq("id", uid).then(done("No se pudo agregar el descanso", refresh));
    });
  });
}

export function vacacionQuitar(desde: string): void {
  supa.auth.getUser().then(function (u) {
    const uid = u.data.user && u.data.user.id;
    if (!uid) return;
    supa.from("profiles").select("vacaciones").eq("id", uid).single().then(function (res) {
      const v: Vaca[] = ((res.data && (res.data as { vacaciones?: Vaca[] }).vacaciones) || []).filter(function (x) { return x.desde !== desde; });
      supa.from("profiles").update({ vacaciones: v }).eq("id", uid).then(done("No se pudo quitar el descanso", refresh));
    });
  });
}

// ---- Horario laboral del paseador (profiles.horario jsonb) ----------------
// dias = ["lun",...]; franjas = [["07:00","12:00"], ...] (2ª opcional). Horas como número (7 → "07:00").
function hhmm(n: number): string { return String(n).padStart(2, "0") + ":00"; }
export function horarioGuardar(dias: string[], f1d: number, f1h: number, f2on: boolean, f2d: number, f2h: number): void {
  const franjas: string[][] = [[hhmm(f1d), hhmm(f1h)]];
  if (f2on) franjas.push([hhmm(f2d), hhmm(f2h)]);
  supa.auth.getUser().then(function (u) {
    const uid = u.data.user && u.data.user.id;
    if (!uid) return;
    supa.from("profiles").update({ horario: { dias: dias, franjas: franjas } }).eq("id", uid).then(done("No se pudo guardar el horario", refresh));
  });
}

// Reprogramar una ocurrencia desde el calendario (arrastrar un bloque):
// modo 'siempre' (misma fecha) cambia la hora recurrente; 'hoy' mueve esa ocurrencia (día/hora).
export function reprogramarBloque(grupo: string, fechaOld: string, fechaNew: string, hora: string, modo: string): void {
  supa.rpc("bloque_reprogramar", { p_grupo: grupo, p_fecha_old: fechaOld, p_fecha_new: fechaNew, p_hora: hora, p_modo: modo }).then(done("No se pudo reprogramar", refresh));
}

// ---- Modo paseo: el paseador ejecuta el paseo (optimista) -----------------
// `ids` = los ids de prestación del grupo, unidos por coma (el store los junta).
// La transición se refleja al instante en el store; el RPC persiste y, si falla,
// `done` avisa + refresca (revierte). Ver supabase/migration_paseo.sql.
function idsArr(ids: string): string[] {
  return (ids || "").split(",").filter(Boolean);
}
// Modo paseo: vía rpcOrQueue → si estás offline, se encola y sincroniza al volver
// la conexión (el store ya mostró el cambio optimista y persiste). Ver outbox.ts.
export function paseoIniciar(ids: string): void {
  const arr = idsArr(ids);
  if (!arr.length) return;
  rpcOrQueue("paseo_marcar", { p_ids: arr, p_estado: "en_curso" });
}
export function paseoFinalizar(ids: string, nota: string): void {
  const arr = idsArr(ids);
  if (!arr.length) return;
  rpcOrQueue("paseo_marcar", { p_ids: arr, p_estado: "finalizado", p_nota: nota || null });
}
// Anexa la URL de una foto (ya subida a Storage por el Custom FotoUpload) a
// detalle.fotos de TODAS las prestaciones del grupo → cada dueño ve las fotos de la
// salida de su perro. Requiere red (la foto ya se subió online). Ver migration_fotos.sql.
export function paseoAgregarFoto(ids: string, url: string): void {
  const arr = idsArr(ids);
  if (!arr.length || !url) return;
  supa.rpc("paseo_agregar_foto", { p_ids: arr, p_url: url }).then(done("No se pudo guardar la foto"));
}

export function perroNoSalio(presId: string, motivo: string): void {
  if (!presId) return;
  rpcOrQueue("paseo_no_salio", { p_id: presId, p_motivo: motivo || "" });
}

// ---- Gestión del negocio (portal EMPRESA) --------------------------------
// Salario mensual fijo de un paseador empleado (profiles.salario_fijo).
export function paseadorSalario(id: string, salario: number): void {
  supa.from("profiles").update({ salario_fijo: salario || 0 }).eq("id", id).then(done("No se pudo actualizar el salario"));
}

// Crea una invitación por RPC: el servidor genera el código (14 símbolos, solo se guarda su hash) y lo
// devuelve UNA vez. Se copia al portapapeles y se avisa a la página ("invite:code") para mostrarlo; no se
// guarda en ningún store. Código perdido = revocar y crear otra.
export function invitarCrear(rol: string, email: string): void {
  const correo = (email || "").trim();
  supa.rpc("invitacion_crear", { p_rol: rol, p_email: correo }).then(function (res) {
    if (res.error || !res.data) { toast(/email_invalido/.test((res.error && res.error.message) || "") ? "El correo no es válido" : "No se pudo crear la invitación"); return; }
    copiarCodigo(res.data as string);
    window.dispatchEvent(new CustomEvent("invite:code", { detail: { codigo: res.data, email: correo.toLowerCase() } }));
    refresh();
  });
}

// Revoca una invitación pendiente (el código deja de servir).
export function invitacionQuitar(id: string): void {
  supa.rpc("invitacion_revocar", { p_id: id }).then(done("No se pudo revocar la invitación", refresh));
}

// Asigna un paseador a una salida (grupos.cuidador_id) vía el RPC grupo_asignar: dueño u
// oficina, y el cuidador debe ser paseador del negocio o el dueño. Las prestaciones FUTURAS
// que genere el grupo usarán este cuidador; las ya materializadas no se retro-cambian.
export function grupoAsignar(grupoId: string, cuidadorId: string): void {
  supa.rpc("grupo_asignar", { p_grupo: grupoId, p_cuidador: cuidadorId || null }).then(done("No se pudo asignar el paseador"));
}

// ---- Cobros (empresa/jefe): marcar una prestación como cobrada (optimista) ----
// RPC cobro_marcar: solo el dueño; el server fija quién y cuándo (auth.uid() / now()).
export function cobroMarcar(id: string): void {
  if (!id) return;
  supa.rpc("cobro_marcar", { p_prestacion: id }).then(done("No se pudo marcar cobrado"));
}

// ---- El CLIENTE registra su propio perro (RPC crear_mi_perro, SECURITY DEFINER)
// El cliente no puede crear la primera fila de perro_duenos por RLS (huevo-y-gallina),
// así que el server crea el perro bajo su negocio + lo enlaza como dueño principal,
// atómico. No es optimista (el id lo genera el server): en éxito refrescamos.
export function crearMiPerro(p: PerroInput): void {
  if (!p || !p.nombre || !p.nombre.trim()) { toast("El perro necesita un nombre"); return; }
  supa.rpc("crear_mi_perro", {
    p_nombre: p.nombre,
    p_raza: p.raza || null,
    p_tamano: p.tamano || null,
    p_conducta: p.conducta || null,
    p_tips: p.tips || null,
    p_sociabilidad: p.sociabilidad || null,
  }).then(done("No se pudo registrar el perro", refresh));
}

// ---- Reserva del CLIENTE ------------------------------------------------------
// El browser NUNCA manda precio ni tipo: el RPC reservar (valida que el perro sea del
// cliente y el servicio de su negocio) saca tipo, cuidador, hora y precio del catálogo/salida.
function reservar(perroId: string, servicioId: string, grupoId: string, fecha: string, errMsg: string): void {
  if (!perroId || !fecha) { toast("Elegí perro y fecha"); return; }
  supa.rpc("reservar", { p_perro: perroId, p_servicio: servicioId || null, p_grupo: grupoId || null, p_fecha: fecha }).then(done(errMsg, refresh));
}

// Acopla su perro a una salida de paseo (el servicio es el de la salida).
export function reservarPaseo(perroId: string, servicioId: string, grupoId: string, fecha: string): void {
  reservar(perroId, servicioId, grupoId, fecha, "No se pudo reservar el paseo");
}

// Pedir un SERVICIO cualquiera (baño, guardería, corte, vet…) sin salida; el negocio lo atiende.
export function reservarServicio(perroId: string, servicioId: string, fecha: string): void {
  reservar(perroId, servicioId, "", fecha, "No se pudo agendar el servicio");
}

// ---- Compra de PRODUCTO (comida / snack), solo el dueño principal del perro ----
// RPC comprar_producto: el server cobra precio del catálogo × cantidad (1..20) y la registra
// como prestación finalizada de hoy, así entra directo a factura/reportes/cobros.
export function venderProducto(perroId: string, servicioId: string, cantidad: number): void {
  if (!perroId || !servicioId) { toast("Elegí producto y perro"); return; }
  const qty = Math.min(20, Math.max(1, Math.floor(cantidad) || 1));
  supa.rpc("comprar_producto", { p_perro: perroId, p_servicio: servicioId, p_cantidad: qty }).then(done("No se pudo registrar la compra", refresh));
}

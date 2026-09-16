// Data write side-effects (fire-and-forget) callable from Muten actions.
// Each persists to Supabase, then dispatches "supa:refresh" so the read bridges
// (DataBootstrap, etc.) re-read and update the stores reactively.
import { supa } from "./authActions";

function refresh(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("supa:refresh"));
  }
}

// Aviso liviano (lo muestra el Custom Toast). Para errores de escritura optimista.
function toast(msg: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("toast", { detail: msg }));
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
  supa.auth.getUser().then(function (u) {
    const uid = u.data.user && u.data.user.id;
    if (!uid) return;
    supa.from("profiles").select("negocio_id").eq("id", uid).single().then(function (res) {
      const neg = res.data && (res.data as { negocio_id?: string }).negocio_id;
      if (!neg) return;
      supa.from("perros").insert({ negocio_id: neg, ...perroFields(p) }).then(function (res) {
        // Alta no es optimista (id lo genera el server): éxito → refresh trae la fila real.
        if (res && (res as { error?: unknown }).error) { toast("No se pudo agregar el perro"); return; }
        refresh();
      });
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

export function perroEliminar(id: string): void {
  // Borrado OPTIMISTA (ya se quitó del store). Limpiamos refs y borramos; el refresh
  // final reconcilia el conteo de relaciones de los demás. Si falla, refresh revierte.
  supa.from("perros").select("incompatibles").eq("id", id).single().then(function (res) {
    const lst: RelEntry[] = ((res.data && (res.data as { incompatibles?: RelEntry[] }).incompatibles) || []);
    const others = lst.map(function (e) { return (e && e.id) ? e.id : (e as unknown as string); }).filter(Boolean);
    const doDelete = function () {
      supa.from("perros").delete().eq("id", id).then(function (dr) {
        if (dr && (dr as { error?: unknown }).error) toast("No se pudo eliminar el perro");
        refresh();
      });
    };
    if (!others.length) { doDelete(); return; }
    let pending = others.length;
    others.forEach(function (otherId) {
      relPut(otherId, id, "", "", "", function () { pending -= 1; if (pending === 0) doDelete(); });
    });
  });
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
  supa.auth.getUser().then(function (u) {
    const uid = u.data.user && u.data.user.id;
    if (!uid) return;
    supa.from("profiles").select("negocio_id").eq("id", uid).single().then(function (res) {
      const neg = res.data && (res.data as { negocio_id?: string }).negocio_id;
      if (!neg) return;
      supa.from("servicios").insert({ negocio_id: neg, activo: true, ...servicioFields(s) }).then(done("No se pudo agregar el servicio", refresh));
    });
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
function conNegocio(fn: (neg: string) => void): void {
  supa.auth.getUser().then(function (u) {
    const uid = u.data.user && u.data.user.id;
    if (!uid) return;
    supa.from("profiles").select("negocio_id").eq("id", uid).single().then(function (pr) {
      const neg = pr.data && (pr.data as { negocio_id?: string }).negocio_id;
      if (neg) fn(neg);
    });
  });
}

export function zonaAgregar(nombre: string): void {
  if (!nombre) return;
  conNegocio(function (neg) {
    supa.from("negocios").select("zonas").eq("id", neg).single().then(function (res) {
      const zonas: string[] = ((res.data && (res.data as { zonas?: string[] }).zonas) || []).slice();
      if (zonas.indexOf(nombre) < 0) zonas.push(nombre);
      supa.from("negocios").update({ zonas }).eq("id", neg).then(done("No se pudo actualizar las zonas"));
    });
  });
}

export function zonaQuitar(nombre: string): void {
  conNegocio(function (neg) {
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
  supa.auth.getUser().then(function (u) {
    const uid = u.data.user && u.data.user.id;
    if (!uid) return;
    supa.from("profiles").select("negocio_id").eq("id", uid).single().then(function (res) {
      const neg = res.data && (res.data as { negocio_id?: string }).negocio_id;
      if (!neg) return;
      supa.from("grupos").insert({ negocio_id: neg, cuidador_id: uid, activo: true, ...grupoFields(g) }).then(done("No se pudo crear la salida", refresh));
    });
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
export function paseoIniciar(ids: string): void {
  const arr = idsArr(ids);
  if (!arr.length) return;
  supa.rpc("paseo_marcar", { p_ids: arr, p_estado: "en_curso" }).then(done("No se pudo iniciar el paseo"));
}
export function paseoFinalizar(ids: string, nota: string): void {
  const arr = idsArr(ids);
  if (!arr.length) return;
  supa.rpc("paseo_marcar", { p_ids: arr, p_estado: "finalizado", p_nota: nota || null }).then(done("No se pudo finalizar el paseo"));
}
export function perroNoSalio(presId: string, motivo: string): void {
  if (!presId) return;
  supa.rpc("paseo_no_salio", { p_id: presId, p_motivo: motivo || "" }).then(done("No se pudo marcar"));
}

// ---- Gestión del negocio (portal EMPRESA) --------------------------------
// Salario mensual fijo de un paseador empleado (profiles.salario_fijo).
export function paseadorSalario(id: string, salario: number): void {
  supa.from("profiles").update({ salario_fijo: salario || 0 }).eq("id", id).then(done("No se pudo actualizar el salario"));
}

// Código de invitación legible (sin caracteres ambiguos).
function genCodigo(): string {
  const s = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 6; i++) c += s.charAt(Math.floor(Math.random() * s.length));
  return c;
}

// Crea una invitación (paseador o cliente) con un código único para compartir.
// La ACEPTACIÓN (signup con código → linkear al negocio) es un flujo aparte, pendiente.
export function invitarCrear(rol: string, email: string): void {
  supa.auth.getUser().then(function (u) {
    const uid = u.data.user && u.data.user.id;
    if (!uid) return;
    supa.from("profiles").select("negocio_id").eq("id", uid).single().then(function (pr) {
      const neg = pr.data && (pr.data as { negocio_id?: string }).negocio_id;
      if (!neg) return;
      supa.from("invitaciones").insert({
        negocio_id: neg, rol: rol, email: email || null, codigo: genCodigo(), estado: "pendiente", invitado_por: uid,
      }).then(done("No se pudo crear la invitación", refresh));
    });
  });
}

// Da de baja una invitación pendiente (soft: estado 'expirada').
export function invitacionQuitar(id: string): void {
  supa.from("invitaciones").update({ estado: "expirada" }).eq("id", id).then(done("No se pudo quitar la invitación"));
}

// Asigna un paseador a una salida (grupos.cuidador_id). Las prestaciones FUTURAS
// que genere el grupo usarán este cuidador; las ya materializadas no se retro-cambian.
export function grupoAsignar(grupoId: string, cuidadorId: string): void {
  supa.from("grupos").update({ cuidador_id: cuidadorId || null }).eq("id", grupoId).then(done("No se pudo asignar el paseador"));
}

// ---- Reserva del CLIENTE: acopla su perro a una salida (crea la prestación) ----
export function reservarPaseo(perroId: string, servicioId: string, tipo: string, cuidadorId: string, hora: string, grupoId: string, fecha: string): void {
  if (!perroId || !fecha) { toast("Elegí perro y fecha"); return; }
  conNegocio(function (neg) {
    supa.from("prestaciones").insert({
      negocio_id: neg, perro_id: perroId, servicio_id: servicioId || null, tipo: tipo || "paseo",
      cuidador_id: cuidadorId || null, fecha: fecha, estado: "programado",
      detalle: { hora: hora || "", grupo_id: grupoId || "" },
    }).then(done("No se pudo reservar el paseo", refresh));
  });
}

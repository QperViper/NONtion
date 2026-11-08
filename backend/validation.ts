export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Se esperaba un objeto JSON.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 255): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, 'Texto vacío o demasiado largo.');
  return value;
}
export function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new HttpError(400, 'Falta una versión válida.');
  return Number(value);
}
export function uuid(value: unknown): string {
  const id = text(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new HttpError(400, 'Identificador inválido.');
  return id;
}
export const settingsFields: Record<string, string> = {
  themeColor: 'theme_color', bgImage: 'bg_image', bgBlur: 'bg_blur', bgBloom: 'bg_bloom',
  sidebarWidth: 'sidebar_width', settingsWidth: 'settings_width', isSidebarOpen: 'is_sidebar_open',
  avatarImage: 'avatar_image', menuIconImage: 'menu_icon_image', customizations: 'customizations',
  backgroundEffect: 'background_effect',
};
const image = (value: unknown) => {
  if (value !== null && (typeof value !== 'string' || value.length > 15_000_000 || !/^(https?:\/\/|\/assets\/|data:image\/(png|jpeg|webp|gif);base64,)/i.test(value))) throw new HttpError(400, 'Imagen inválida.');
};
export function validatePatch(body: Record<string, unknown>, kind: 'settings' | 'document' | 'whiteboard' | 'event') {
  version(body.version);
  if (kind === 'event') return validateEvent(body);
  const fields: Record<string,string> = kind === 'settings' ? settingsFields : kind === 'document'
    ? { title: 'title', icon: 'icon', coverImage: 'cover_image', content: 'content', isFavorite: 'is_favorite', deletedAt: 'deleted_at' }
    : { title: 'name', snapshot: 'snapshot', deletedAt: 'deleted_at' };
  const entries = Object.entries(body).filter(([key]) => key !== 'version');
  if (!entries.length) throw new HttpError(400, 'No hay cambios.');
  return entries.map(([key, value]) => {
    if (!Object.hasOwn(fields, key)) throw new HttpError(400, `Campo no permitido: ${key}`);
    if (key === 'backgroundEffect' && value !== null && value !== 'vignette-bloom') throw new HttpError(400, 'Fondo animado no válido.');
    if (key === 'title' && (typeof value !== 'string' || value.length > 255)) throw new HttpError(400, 'Título inválido.');
    if (['icon', 'coverImage', 'bgImage', 'avatarImage', 'menuIconImage'].includes(key)) image(value);
    if (key === 'content' && !Array.isArray(value)) throw new HttpError(400, 'Contenido inválido.');
    if (key === 'snapshot') object(value);
    if (key === 'deletedAt' && value !== null && (typeof value !== 'string' || Number.isNaN(Date.parse(value)))) throw new HttpError(400, 'Fecha inválida.');
    if (['isFavorite', 'isSidebarOpen'].includes(key) && typeof value !== 'boolean') throw new HttpError(400, 'Booleano inválido.');
    const ranges: Record<string, [number, number]> = { bgBlur: [0, 30], bgBloom: [25, 200], sidebarWidth: [180, 600], settingsWidth: [300, 700] };
    if (ranges[key] && (!Number.isInteger(value) || Number(value) < ranges[key][0] || Number(value) > ranges[key][1])) throw new HttpError(400, 'Valor fuera de rango.');
    if (key === 'themeColor' && (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))) throw new HttpError(400, 'Color inválido.');
    if (key === 'customizations') {
      const config = object(value);
      if (JSON.stringify(config).length > 200_000) throw new HttpError(400, 'Personalización demasiado grande.');
      for (const [id, control] of Object.entries(config)) {
        if (!/^[a-z][a-z0-9.-]{0,99}$/i.test(id)) throw new HttpError(400, 'Control inválido.');
        const c = object(control);
        for (const field of Object.keys(c)) if (!['emoji','image','color','background','size','radius','hidden','zone','order'].includes(field)) throw new HttpError(400, 'Estilo no permitido.');
        if (c.emoji !== undefined && (typeof c.emoji !== 'string' || c.emoji.length > 24)) throw new HttpError(400, 'Emoji inválido.');
        if (c.image !== undefined) image(c.image);
        for (const field of ['color', 'background']) if (c[field] !== undefined && !/^#[0-9a-f]{6}$/i.test(String(c[field]))) throw new HttpError(400, 'Color inválido.');
        for (const field of ['size', 'radius', 'order']) if (c[field] !== undefined && (!Number.isInteger(c[field]) || Number(c[field]) < 0 || Number(c[field]) > (field === 'size' ? 48 : field === 'radius' ? 24 : 100))) throw new HttpError(400, 'Estilo fuera de rango.');
        if (c.hidden !== undefined && typeof c.hidden !== 'boolean') throw new HttpError(400, 'Visibilidad inválida.');
        if (c.zone !== undefined && !['sidebar','toolbar'].includes(String(c.zone))) throw new HttpError(400, 'Zona inválida.');
      }
    }
    return { column: fields[key], value: ['content', 'snapshot', 'customizations'].includes(key) ? JSON.stringify(value) : key === 'title' ? String(value).trim() || 'Sin título' : value };
  });
}

/** Calendario: campos del evento (nombre en la app → columna). */
export const eventFields: Record<string, string> = {
  title: 'title', description: 'description', emoji: 'emoji', color: 'color', priority: 'priority', allDay: 'all_day',
  startAt: 'start_at', endAt: 'end_at', completed: 'completed', documentId: 'document_id', deletedAt: 'deleted_at',
};
export const PRIORITIES = ['baja', 'media', 'alta', 'urgente'] as const;
const instant = (value: unknown, label: string) => {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  // Fecha con zona horaria explícita (ISO 8601), entre 1900 y 2200.
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(time) || time < Date.UTC(1900, 0, 1) || time > Date.UTC(2200, 0, 1)) {
    throw new HttpError(400, `${label} inválida.`);
  }
  return new Date(time).toISOString();
};
function eventValue(key: string, value: unknown): unknown {
  switch (key) {
    case 'title': {
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) throw new HttpError(400, 'El título es obligatorio (máximo 200 caracteres).');
      return value.trim();
    }
    case 'description':
      if (typeof value !== 'string' || value.length > 10_000) throw new HttpError(400, 'Descripción demasiado larga.');
      return value;
    case 'emoji':
      if (value === null || value === '') return null;
      if (typeof value !== 'string' || [...value].length > 8 || value.length > 16) throw new HttpError(400, 'Emoji inválido.');
      return value;
    case 'color':
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new HttpError(400, 'Color inválido.');
      return value;
    case 'priority':
      if (!PRIORITIES.includes(value as (typeof PRIORITIES)[number])) throw new HttpError(400, 'Prioridad inválida.');
      return value;
    case 'allDay': case 'completed':
      if (typeof value !== 'boolean') throw new HttpError(400, 'Booleano inválido.');
      return value;
    case 'startAt': return instant(value, 'Fecha de inicio');
    case 'endAt': return instant(value, 'Fecha de término');
    case 'documentId':
      if (value === null) return null;
      return uuid(value);
    case 'deletedAt':
      if (value === null) return null;
      return instant(value, 'Fecha');
    default: throw new HttpError(400, `Campo no permitido: ${key}`);
  }
}
/** Valida un evento nuevo (create) o un cambio parcial. Devuelve columnas y valores listos para SQL. */
export function validateEvent(body: Record<string, unknown>, { create = false } = {}) {
  const entries = Object.entries(body).filter(([key]) => key !== 'version' && key !== 'id');
  if (!entries.length) throw new HttpError(400, 'No hay cambios.');
  const out = entries.map(([key, value]) => {
    if (!Object.hasOwn(eventFields, key)) throw new HttpError(400, `Campo no permitido: ${key}`);
    return { key, column: eventFields[key], value: eventValue(key, value) };
  });
  const get = (key: string) => out.find(f => f.key === key)?.value as string | undefined;
  if (create) {
    for (const key of ['title', 'startAt', 'endAt']) if (get(key) === undefined) throw new HttpError(400, 'Faltan título, inicio o término.');
    if (get('deletedAt') !== undefined) throw new HttpError(400, 'Campo no permitido: deletedAt');
  }
  const start = get('startAt'), end = get('endAt');
  if (start && end && Date.parse(end) < Date.parse(start)) throw new HttpError(400, 'El término no puede ser anterior al inicio.');
  return out.map(({ column, value }) => ({ column, value }));
}

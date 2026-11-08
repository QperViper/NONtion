import type { CalendarEvent, EventInput } from './resources.ts';

// Fechas del calendario en hora local del equipo. Eventos de todo el día: inicio a medianoche y
// fin EXCLUSIVO (medianoche del día siguiente al último), igual que FullCalendar.
const pad = (n: number) => String(n).padStart(2, '0');
const DAY = 86_400_000;

export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
export const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());

/** Valor para <input type="date"> o <input type="datetime-local">. */
export function toInputValue(iso: string, allDay: boolean) {
  const d = new Date(iso);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return allDay ? day : `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** Lee un <input type="date"/"datetime-local"> como hora local (new Date('2026-11-10') sería UTC). */
export function fromInputValue(value: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** En el formulario, el último día de un evento de todo el día se muestra incluido. */
export const inclusiveEnd = (endIso: string) => addDays(new Date(endIso), -1).toISOString();
export const exclusiveEnd = (lastDay: Date) => addDays(startOfDay(lastDay), 1);

/** Al marcar o desmarcar «Todo el día», ajusta el rango para que siga teniendo sentido. */
export function switchAllDay(range: { startAt: string; endAt: string }, allDay: boolean) {
  const start = new Date(range.startAt), end = new Date(range.endAt);
  if (allDay) {
    const first = startOfDay(start);
    // 10:00–11:00 del martes → todo el martes; 22:00 lunes–02:00 martes → lunes y martes.
    const last = end.getTime() === startOfDay(end).getTime() && end > first ? addDays(end, -1) : end;
    return { startAt: first.toISOString(), endAt: exclusiveEnd(last < first ? first : last).toISOString() };
  }
  const at9 = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 9, 0);
  return { startAt: at9.toISOString(), endAt: new Date(at9.getTime() + 3_600_000).toISOString() };
}

/** Rango por defecto de un evento nuevo: la próxima hora en punto, de una hora. */
export function defaultRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0);
  return { startAt: start.toISOString(), endAt: new Date(start.getTime() + 3_600_000).toISOString(), allDay: false };
}

/** Al soltar un evento sin término (pasó de todo el día a horas o al revés) se le da una duración razonable. */
export function fallbackEnd(start: Date, allDay: boolean) {
  return allDay ? addDays(startOfDay(start), 1) : new Date(start.getTime() + 3_600_000);
}

/** Texto corto para «Próximos»: hoy 14:00 · mañana · jue 12 nov. */
export function shortWhen(iso: string, allDay: boolean, now = new Date()) {
  const d = new Date(iso);
  const days = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / DAY);
  const time = allDay ? '' : ` ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (days === 0) return `hoy${time}`;
  if (days === 1) return `mañana${time}`;
  return `${d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '')}${time}`;
}

/** Color de texto legible sobre el color del evento. */
export function readableText(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#141414' : '#ffffff';
}

export const EVENT_COLORS = ['#2383e2', '#0f7b6c', '#6940a5', '#ad1a72', '#e03e3e', '#d9730d', '#dfab01', '#64646f'];
export const QUICK_EMOJIS = ['📚', '📝', '🧪', '📐', '💼', '🏃', '🎉', '⏰'];

/** Evento en edición (sin id = nuevo). */
export type EventDraft = { id?: string } & EventInput;
export const blankEvent = (range: { startAt: string; endAt: string; allDay: boolean }): EventDraft => ({
  title: '', description: '', emoji: null, color: EVENT_COLORS[0], priority: 'media', completed: false, documentId: null, ...range,
});
export function draftOf(event: CalendarEvent): EventDraft {
  const { version: _version, deletedAt: _deleted, ...rest } = event;
  return rest;
}

/** Hasta 3 eventos sin completar de los próximos 7 días (o en curso). */
export function upcoming(events: CalendarEvent[], now: number, limit = 3) {
  return events.filter(e => !e.deletedAt && !e.completed && Date.parse(e.endAt) > now && Date.parse(e.startAt) < now + 7 * DAY)
    .sort((a, b) => a.startAt.localeCompare(b.startAt)).slice(0, limit);
}

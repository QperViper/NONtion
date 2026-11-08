import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRange, exclusiveEnd, fallbackEnd, fromInputValue, inclusiveEnd, readableText, shortWhen, switchAllDay, toInputValue } from '../../src/lib/calendar.ts';
import { eventRow } from '../../src/lib/resources.ts';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

test('los campos de fecha se leen y escriben en hora local', () => {
  assert.equal(fromInputValue('2026-11-10')!.getTime(), local(2026, 11, 10).getTime(), 'una fecha sola es medianoche local, no UTC');
  assert.equal(fromInputValue('2026-11-10T09:30')!.getTime(), local(2026, 11, 10, 9, 30).getTime());
  assert.equal(fromInputValue(''), null);
  assert.equal(fromInputValue('10/11/2026'), null);
  const iso = local(2026, 11, 10, 9, 5).toISOString();
  assert.equal(toInputValue(iso, false), '2026-11-10T09:05');
  assert.equal(toInputValue(iso, true), '2026-11-10');
});

test('todo el día: el formulario muestra el último día incluido y guarda el siguiente', () => {
  const end = exclusiveEnd(local(2026, 11, 12, 15));
  assert.equal(end.getTime(), local(2026, 11, 13).getTime());
  assert.equal(new Date(inclusiveEnd(end.toISOString())).getTime(), local(2026, 11, 12).getTime());
});

test('marcar y desmarcar «Todo el día» mantiene un rango con sentido', () => {
  const morning = { startAt: local(2026, 11, 10, 10).toISOString(), endAt: local(2026, 11, 10, 11).toISOString() };
  const whole = switchAllDay(morning, true);
  assert.equal(new Date(whole.startAt).getTime(), local(2026, 11, 10).getTime());
  assert.equal(new Date(whole.endAt).getTime(), local(2026, 11, 11).getTime(), 'un evento de horas pasa a ocupar su día');
  const night = switchAllDay({ startAt: local(2026, 11, 9, 22).toISOString(), endAt: local(2026, 11, 10, 2).toISOString() }, true);
  assert.equal(new Date(night.endAt).getTime(), local(2026, 11, 11).getTime(), 'cruza la medianoche: dos días');
  const exact = switchAllDay({ startAt: local(2026, 11, 10).toISOString(), endAt: local(2026, 11, 11).toISOString() }, true);
  assert.equal(new Date(exact.endAt).getTime(), local(2026, 11, 11).getTime(), 'ya era un día exacto: no se alarga');
  const timed = switchAllDay(whole, false);
  assert.equal(new Date(timed.startAt).getTime(), local(2026, 11, 10, 9).getTime());
  assert.equal(new Date(timed.endAt).getTime(), local(2026, 11, 10, 10).getTime());
});

test('rangos por defecto, textos cortos y contraste', () => {
  const range = defaultRange(local(2026, 11, 10, 14, 25));
  assert.equal(new Date(range.startAt).getTime(), local(2026, 11, 10, 15).getTime());
  assert.equal(new Date(range.endAt).getTime(), local(2026, 11, 10, 16).getTime());
  assert.equal(fallbackEnd(local(2026, 11, 10, 15), true).getTime(), local(2026, 11, 11).getTime());
  const now = local(2026, 11, 10, 8);
  assert.equal(shortWhen(local(2026, 11, 10, 14).toISOString(), false, now), 'hoy 14:00');
  assert.equal(shortWhen(local(2026, 11, 11).toISOString(), true, now), 'mañana');
  assert.match(shortWhen(local(2026, 11, 12, 9).toISOString(), false, now), /12.*09:00$/);
  assert.equal(readableText('#dfab01'), '#141414');
  assert.equal(readableText('#2383e2'), '#ffffff');
});

test('una fila de la base se convierte en evento de la app', () => {
  const event = eventRow({ id: 'e1', title: 'Examen', description: null, emoji: null, color: '#e03e3e', priority: 'urgente', all_day: true,
    start_at: '2026-11-12T03:00:00.000Z', end_at: new Date('2026-11-13T03:00:00Z'), completed: false, document_id: null, version: 2, deleted_at: null });
  assert.equal(event.allDay, true); assert.equal(event.description, ''); assert.equal(event.endAt, '2026-11-13T03:00:00.000Z');
  assert.equal(event.priority, 'urgente'); assert.equal(event.deletedAt, null);
});

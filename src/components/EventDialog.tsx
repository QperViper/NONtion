import { useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import Dialog from './Dialog';
import { useAppStore } from '../store/useAppStore';
import type { EventInput } from '../store/useAppStore';
import { PRIORITIES } from '../lib/resources';
import { EVENT_COLORS, QUICK_EMOJIS, exclusiveEnd, fromInputValue, inclusiveEnd, switchAllDay, toInputValue } from '../lib/calendar';
import type { EventDraft } from '../lib/calendar';

/** Crear o editar un evento. Solo envía los campos que cambiaron. */
export default function EventDialog({ initial, onClose }: { initial: EventDraft; onClose: () => void }) {
  const [form, setForm] = useState<EventDraft>(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => setForm(f => ({ ...f, [key]: value }));
  const editing = Boolean(initial.id);
  // En todo el día, el campo «Hasta» muestra el último día incluido.
  const endShown = form.allDay ? inclusiveEnd(form.endAt) : form.endAt;
  const invalidRange = new Date(form.endAt) < new Date(form.startAt) || (form.allDay && new Date(form.endAt) <= new Date(form.startAt));
  const error = !form.title.trim() ? 'Escribe un título.' : invalidRange ? 'El término no puede ser anterior al inicio.' : null;

  const setStart = (value: string) => {
    const date = fromInputValue(value); if (!date) return;
    // Mover el inicio arrastra el término para conservar la duración.
    const duration = new Date(form.endAt).getTime() - new Date(form.startAt).getTime();
    setForm(f => ({ ...f, startAt: date.toISOString(), endAt: new Date(date.getTime() + Math.max(duration, 0)).toISOString() }));
  };
  const setEnd = (value: string) => {
    const date = fromInputValue(value); if (!date) return;
    set('endAt', (form.allDay ? exclusiveEnd(date) : date).toISOString());
  };
  const save = async () => {
    if (error || saving) return;
    const clean: EventInput = { ...form, title: form.title.trim(), emoji: form.emoji?.trim() || null };
    const store = useAppStore.getState();
    if (form.id) {
      const changed = Object.fromEntries(Object.entries(clean).filter(([key, value]) => key !== 'id' && value !== initial[key as keyof EventDraft])) as Partial<EventInput>;
      if (Object.keys(changed).length) store.updateEvent(form.id, changed);
      onClose();
    } else {
      setSaving(true);
      const id = await store.createEvent(clean);
      setSaving(false);
      if (id) onClose();
    }
  };

  return <Dialog onClose={onClose} labelledBy="event-dialog-title" className="event-dialog">
    <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <h2 id="event-dialog-title" className="sr-only">{editing ? 'Editar evento' : 'Nuevo evento'}</h2>
      <div className="event-title-row">
        <input className="event-emoji" aria-label="Emoji" placeholder="🙂" value={form.emoji ?? ''} maxLength={16} onChange={e => set('emoji', e.target.value || null)}/>
        <input className="event-title" aria-label="Título" placeholder={editing ? 'Título' : 'Nuevo evento'} autoFocus value={form.title} maxLength={200} onChange={e => set('title', e.target.value)}/>
      </div>
      <div className="event-quick" role="group" aria-label="Emojis rápidos">
        {QUICK_EMOJIS.map(emoji => <button type="button" key={emoji} className={`event-chip${form.emoji === emoji ? ' is-selected' : ''}`} aria-pressed={form.emoji === emoji} onClick={() => set('emoji', form.emoji === emoji ? null : emoji)}>{emoji}</button>)}
      </div>

      <label className="event-check"><input type="checkbox" checked={form.allDay} onChange={e => setForm(f => ({ ...f, allDay: e.target.checked, ...switchAllDay(f, e.target.checked) }))}/> Todo el día</label>
      <div className="event-range">
        <label><span>Desde</span><input type={form.allDay ? 'date' : 'datetime-local'} value={toInputValue(form.startAt, form.allDay)} onChange={e => setStart(e.target.value)} required/></label>
        <label><span>Hasta</span><input type={form.allDay ? 'date' : 'datetime-local'} value={toInputValue(endShown, form.allDay)} onChange={e => setEnd(e.target.value)} required/></label>
      </div>

      <fieldset className="event-field">
        <legend>Prioridad</legend>
        <div className="event-segment">
          {PRIORITIES.map(p => <label key={p.id} className={`prio-${p.id}${form.priority === p.id ? ' is-selected' : ''}`}>
            <input type="radio" name="priority" value={p.id} checked={form.priority === p.id} onChange={() => set('priority', p.id)}/>{p.label}
          </label>)}
        </div>
      </fieldset>

      <fieldset className="event-field">
        <legend>Color</legend>
        <div className="event-colors">
          {EVENT_COLORS.map(color => <button type="button" key={color} className={`event-swatch${form.color === color ? ' is-selected' : ''}`} style={{ background: color }} aria-label={`Color ${color}`} aria-pressed={form.color === color} onClick={() => set('color', color)}>{form.color === color && <Check size={13}/>}</button>)}
          <label className={`event-swatch event-custom${EVENT_COLORS.includes(form.color) ? '' : ' is-selected'}`} style={{ background: EVENT_COLORS.includes(form.color) ? undefined : form.color }} title="Otro color">
            <input type="color" aria-label="Otro color" value={form.color} onChange={e => set('color', e.target.value)}/>+
          </label>
        </div>
      </fieldset>

      <label className="event-field"><span className="event-legend">Descripción</span>
        <textarea rows={3} value={form.description} maxLength={10000} placeholder="Notas, lugar, enlaces…" onChange={e => set('description', e.target.value)}/>
      </label>
      {editing && <label className="event-check"><input type="checkbox" checked={form.completed} onChange={e => set('completed', e.target.checked)}/> Completado</label>}

      {error && form.title !== '' && <p className="event-error" role="alert">{error}</p>}
      <div className="event-actions">
        {editing && (confirmDelete
          ? <button type="button" className="soft-button event-danger" onClick={() => { useAppStore.getState().deleteEvent(form.id!); onClose(); }}>¿Eliminar? Sí</button>
          : <button type="button" className="quiet-button" onClick={() => setConfirmDelete(true)}><Trash2 size={14}/> Eliminar</button>)}
        <span className="flex-1"/>
        <button type="button" className="quiet-button" onClick={onClose}>Cancelar</button>
        <button type="submit" className="soft-button event-primary" disabled={Boolean(error) || saving}>{saving ? 'Guardando…' : editing ? 'Guardar' : 'Crear'}</button>
      </div>
    </form>
  </Dialog>;
}

import { useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import esLocale from '@fullcalendar/core/locales/es';
import type { EventContentArg, EventDropArg, EventInput as CalendarItem } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { Plus } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import EventDialog from '../components/EventDialog';
import { blankEvent, defaultRange, draftOf, fallbackEnd, readableText } from '../lib/calendar';
import type { EventDraft } from '../lib/calendar';

const VIEWS = ['dayGridMonth', 'timeGridWeek', 'timeGridDay', 'listWeek'];
const savedView = () => { try { const v = localStorage.getItem('nontion-calendar-view'); return v && VIEWS.includes(v) ? v : 'dayGridMonth'; } catch { return 'dayGridMonth'; } };
const PRIORITY_MARK: Record<string, string> = { alta: '!', urgente: '!!' };

function EventLabel({ arg }: { arg: EventContentArg }) {
  const { emoji, priority, completed } = arg.event.extendedProps as { emoji: string | null; priority: string; completed: boolean };
  return <div className={`cal-event${completed ? ' is-completed' : ''}`}>
    {arg.timeText && !arg.event.allDay && <span className="cal-time">{arg.timeText}</span>}
    {emoji && <span className="cal-emoji" aria-hidden>{emoji}</span>}
    <span className="cal-title">{arg.event.title}</span>
    {PRIORITY_MARK[priority] && <span className={`cal-prio prio-${priority}`} title={`Prioridad ${priority}`}>{PRIORITY_MARK[priority]}</span>}
  </div>;
}

export default function Calendar() {
  const events = useAppStore(s => s.events);
  const [dialog, setDialog] = useState<EventDraft | null>(null);
  const calendar = useRef<FullCalendar>(null);
  const items = useMemo<CalendarItem[]>(() => events.filter(e => !e.deletedAt).map(e => ({
    id: e.id, title: e.title, start: e.startAt, end: e.endAt, allDay: e.allDay,
    backgroundColor: e.color, borderColor: e.color, textColor: readableText(e.color),
    // Un evento que todavía se está creando no se puede arrastrar.
    editable: e.version > 0,
    classNames: [`prio-${e.priority}`, ...(e.completed ? ['is-completed'] : [])],
    extendedProps: { emoji: e.emoji, priority: e.priority, completed: e.completed },
  })), [events]);

  const moved = (arg: EventDropArg | EventResizeDoneArg) => {
    const start = arg.event.start!;
    const end = arg.event.end ?? fallbackEnd(start, arg.event.allDay);
    useAppStore.getState().updateEvent(arg.event.id, { startAt: start.toISOString(), endAt: end.toISOString(), allDay: arg.event.allDay });
  };

  return <div className="calendar-page">
    <header className="calendar-header">
      <h1>Calendario</h1>
      <button className="soft-button" onClick={() => setDialog(blankEvent(defaultRange()))}><Plus size={15}/> Nuevo evento</button>
    </header>
    <div className="calendar-surface">
      <FullCalendar ref={calendar}
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        locale={esLocale} firstDay={1} initialView={savedView()} height="100%"
        headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek' }}
        buttonText={{ today: 'Hoy', month: 'Mes', week: 'Semana', day: 'Día', list: 'Agenda' }}
        events={items} eventContent={arg => <EventLabel arg={arg}/>}
        selectable selectMirror editable nowIndicator dayMaxEvents={3} scrollTime="07:00:00"
        // Tocar un día o arrastrar sobre las horas abre un evento nuevo con ese rango.
        select={info => { setDialog(blankEvent({ startAt: info.start.toISOString(), endAt: info.end.toISOString(), allDay: info.allDay })); calendar.current?.getApi().unselect(); }}
        eventClick={info => { const event = useAppStore.getState().events.find(e => e.id === info.event.id); if (event && event.version > 0) setDialog(draftOf(event)); }}
        eventDrop={moved} eventResize={moved}
        datesSet={info => { try { localStorage.setItem('nontion-calendar-view', info.view.type); } catch { /* solo comodidad */ } }}
        noEventsText="Sin eventos en este período."/>
    </div>
    {dialog && <EventDialog initial={dialog} onClose={() => setDialog(null)}/>}
  </div>;
}

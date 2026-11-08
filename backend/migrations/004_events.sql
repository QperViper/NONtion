-- Calendario: eventos con emoji, color, prioridad y rango de fechas. Mismo patrón que páginas y pizarras:
-- versión para detectar conflictos entre equipos, papelera (deleted_at) y seguimiento de cambios (change_xid).
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 10000),
  emoji text CHECK (emoji IS NULL OR char_length(emoji) <= 16),
  color text NOT NULL DEFAULT '#2383e2' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  priority text NOT NULL DEFAULT 'media' CHECK (priority IN ('baja','media','alta','urgente')),
  all_day boolean NOT NULL DEFAULT false,
  -- Todo el día: medianoche local de inicio y del día SIGUIENTE al último (fin exclusivo, como FullCalendar).
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  change_xid xid8,
  CONSTRAINT events_range CHECK (end_at >= start_at)
);

DROP TRIGGER IF EXISTS nontion_change ON events;
CREATE TRIGGER nontion_change BEFORE INSERT OR UPDATE ON events FOR EACH ROW EXECUTE FUNCTION nontion_mark_change();

-- Consultas por rango de fechas y por cambios recientes.
CREATE INDEX IF NOT EXISTS events_start ON events(start_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS events_change_xid ON events(change_xid);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

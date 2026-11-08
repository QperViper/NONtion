-- Sincronización entre equipos: cada fila guarda la transacción que la cambió por última vez.
-- GET /api/changes devuelve las filas con change_xid >= cursor, donde el cursor es el xmin de la
-- instantánea anterior. Así no se pierde una escritura que confirmó tarde (puede repetirse; es idempotente).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS change_xid xid8;
ALTER TABLE whiteboards ADD COLUMN IF NOT EXISTS change_xid xid8;
ALTER TABLE hyperthreads ADD COLUMN IF NOT EXISTS change_xid xid8;
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS change_xid xid8;

CREATE OR REPLACE FUNCTION nontion_mark_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.change_xid := pg_current_xact_id();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS nontion_change ON documents;
CREATE TRIGGER nontion_change BEFORE INSERT OR UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION nontion_mark_change();
DROP TRIGGER IF EXISTS nontion_change ON whiteboards;
CREATE TRIGGER nontion_change BEFORE INSERT OR UPDATE ON whiteboards FOR EACH ROW EXECUTE FUNCTION nontion_mark_change();
DROP TRIGGER IF EXISTS nontion_change ON hyperthreads;
CREATE TRIGGER nontion_change BEFORE INSERT OR UPDATE ON hyperthreads FOR EACH ROW EXECUTE FUNCTION nontion_mark_change();
DROP TRIGGER IF EXISTS nontion_change ON workspace_settings;
CREATE TRIGGER nontion_change BEFORE INSERT OR UPDATE ON workspace_settings FOR EACH ROW EXECUTE FUNCTION nontion_mark_change();

-- Filas existentes: el disparador les asigna la transacción de esta migración (no cambia versión ni fechas).
UPDATE documents SET change_xid = NULL WHERE change_xid IS NULL;
UPDATE whiteboards SET change_xid = NULL WHERE change_xid IS NULL;
UPDATE hyperthreads SET change_xid = NULL WHERE change_xid IS NULL;
UPDATE workspace_settings SET change_xid = NULL WHERE change_xid IS NULL;

CREATE INDEX IF NOT EXISTS documents_change_xid ON documents(change_xid);
CREATE INDEX IF NOT EXISTS whiteboards_change_xid ON whiteboards(change_xid);
CREATE INDEX IF NOT EXISTS hyperthreads_change_xid ON hyperthreads(change_xid);

-- En Supabase, las tablas de "public" quedan expuestas por su API REST. La app se conecta como dueña
-- de las tablas (no le afecta RLS); activarlo sin políticas cierra ese acceso público. En local no cambia nada.
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE hyperthreads ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

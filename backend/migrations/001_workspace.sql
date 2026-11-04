CREATE TABLE IF NOT EXISTS workspace_settings (
 id integer PRIMARY KEY CHECK (id=1), workspace_name varchar(255) NOT NULL DEFAULT 'Espacio de Nicolás',
 theme_color varchar(32) NOT NULL DEFAULT '#191919', bg_image text, bg_blur integer NOT NULL DEFAULT 2,
 bg_bloom integer NOT NULL DEFAULT 100, sidebar_width integer NOT NULL DEFAULT 256,
 settings_width integer NOT NULL DEFAULT 360, is_sidebar_open boolean NOT NULL DEFAULT true,
 avatar_image text, menu_icon_image text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_id uuid REFERENCES documents(id) ON DELETE SET NULL,
 title varchar(255) NOT NULL DEFAULT 'Sin título', icon text, cover_image text,
 content jsonb NOT NULL DEFAULT '[]', is_favorite boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS whiteboards (
 id varchar(255) PRIMARY KEY DEFAULT 'main-whiteboard', name varchar(255) NOT NULL DEFAULT 'Pizarra infinita',
 snapshot jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hyperthreads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_doc_id uuid REFERENCES documents(id) ON DELETE CASCADE,
 source_text text NOT NULL, destination_title varchar(255) NOT NULL, destination_path varchar(255) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE whiteboards ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE whiteboards ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS customizations jsonb NOT NULL DEFAULT '{}';
ALTER TABLE hyperthreads ADD COLUMN IF NOT EXISTS source_block_id text;
ALTER TABLE hyperthreads ADD COLUMN IF NOT EXISTS destination_type text;
ALTER TABLE hyperthreads ADD COLUMN IF NOT EXISTS destination_id text;
UPDATE hyperthreads SET destination_type='document', destination_id=substring(destination_path from 2)
 WHERE destination_type IS NULL AND destination_path ~ '^/[0-9a-fA-F-]{36}$';
UPDATE hyperthreads SET destination_type='whiteboard', destination_id='main-whiteboard'
 WHERE destination_type IS NULL AND destination_path='/pizarra';
INSERT INTO workspace_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS hyperthreads_destination ON hyperthreads(destination_type,destination_id);
CREATE INDEX IF NOT EXISTS hyperthreads_source ON hyperthreads(source_doc_id);

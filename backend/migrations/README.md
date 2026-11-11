# Esquema de Supabase

nontion ya no ejecuta estas migraciones (no hay PostgreSQL local): los datos viven en
`backend/data/local_db.json` y se sincronizan con Supabase mediante `@supabase/supabase-js`.

Estos archivos describen las tablas que la sincronización espera en Supabase. Si algún día creas un
proyecto de Supabase nuevo, pégalos en orden (001 → 004) en **SQL Editor** y ejecútalos.
Tu proyecto actual ya los tiene aplicados.

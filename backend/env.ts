import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// backend/.env es opcional: sin él, nontion funciona 100 % en local y simplemente no sincroniza.
dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)), quiet: true });

/**
 * Carpeta de datos locales (local_db.json + imágenes). Por defecto backend/data/.
 * NONTION_DATA_DIR permite moverla fuera de una carpeta sincronizada por OneDrive/Dropbox
 * (dos programas sincronizando el mismo archivo terminan en conflictos de copia).
 */
export const dataDir = process.env.NONTION_DATA_DIR
  ? path.resolve(process.env.NONTION_DATA_DIR)
  : fileURLToPath(new URL('./data/', import.meta.url));

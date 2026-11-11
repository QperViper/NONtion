import path from 'node:path';
import { dataDir } from './env.ts';
import { FileStorageService } from './fileStorage.ts';

/** Archivo de datos de este equipo. */
export const localDbFile = path.join(dataDir, 'local_db.json');

/** Instancia única: la abre el primer módulo que la importa (crea carpeta y archivo si no existen). */
export const localDb = await FileStorageService.open(localDbFile);

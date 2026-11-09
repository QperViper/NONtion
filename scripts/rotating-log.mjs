// Registro con límite de tamaño: al pasar de `max` se renombra a «archivo.1» (reemplazando el anterior)
// y se empieza de cero. Así logs\ nunca crece más de ~2 × max por archivo.
// Abre y cierra el archivo en cada escritura: en Windows un archivo abierto no se puede renombrar.
import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';

export const LOG_MAX_BYTES = 2 * 1024 * 1024;

export function rotatingLog(file, max = LOG_MAX_BYTES) {
  let size = existsSync(file) ? statSync(file).size : 0;
  return text => {
    const data = Buffer.isBuffer(text) ? text : Buffer.from(String(text));
    if (size > 0 && size + data.length > max) {
      try { renameSync(file, `${file}.1`); size = 0; } catch { /* si otro proceso lo tiene abierto, se intenta en la próxima línea */ }
    }
    try { appendFileSync(file, data); size += data.length; } catch { /* el registro nunca debe tumbar la app */ }
  };
}

import express from 'express';
import type { Express } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const distDir = fileURLToPath(new URL('../dist/', import.meta.url));

/**
 * Sirve la interfaz compilada (`vite build`) desde la misma API, en un solo puerto.
 * Los archivos de Vite van en /static (con hash, caché larga); /assets queda para las imágenes subidas.
 */
export function serveUi(app: Express): boolean {
  const index = path.join(distDir, 'index.html');
  if (!existsSync(index)) return false;
  app.use('/static', express.static(path.join(distDir, 'static'), { immutable: true, maxAge: '1y', fallthrough: false }));
  app.use(express.static(distDir, { index: false, maxAge: 0 }));
  // Rutas de la aplicación (/:documentId, /pizarra/:id, /hilo/:id…) → index.html.
  app.get(/^\/(?!api(?:\/|$)|assets\/|static\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  return true;
}

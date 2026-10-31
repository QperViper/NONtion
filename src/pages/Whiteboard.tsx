import { Tldraw } from '@tldraw/tldraw';
import '@tldraw/tldraw/tldraw.css';

export default function Whiteboard() {
  return (
    <div className="w-full h-full relative">
      {/* 
        persistenceKey guarda automáticamente todo lo que dibujes en el navegador.
        Más adelante conectaremos esto a Supabase.
      */}
      <Tldraw persistenceKey="mi-pizarra-local" />
    </div>
  );
}
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { Image as ImageIcon, SmilePlus, Link2, Copy, Scissors } from 'lucide-react';
import { useState, useEffect } from 'react';
// Importamos el estado global
import { useAppStore } from '../store/useAppStore';

export default function Workspace() {
  // Extraemos las funciones para controlar el buscador y la memoria de conexiones
  const { setPendingConnectionText, setSearchOpen } = useAppStore();

  const editor = useCreateBlockNote({
    initialContent: [
      { type: "paragraph", content: "Arrastra el mouse sobre una palabra aquí y haz clic derecho." },
      { type: "paragraph" }
    ]
  });

  // Estado para controlar la posición y el contenido del menú de clic derecho
  const [contextMenu, setContextMenu] = useState({
    isOpen: false,
    x: 0,
    y: 0,
    selectedText: ''
  });

  // Escuchar clics normales para cerrar el menú si haces clic en otro lado
  useEffect(() => {
    const closeMenu = () => setContextMenu(prev => ({ ...prev, isOpen: false }));
    document.addEventListener('click', closeMenu);
    return () => document.removeEventListener('click', closeMenu);
  }, []);

  // Función que bloquea el menú de Windows y abre el nuestro
  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault(); // Bloquea el menú normal del navegador
    
    // Captura el texto que el usuario tenga subrayado con el mouse
    const text = window.getSelection()?.toString().trim() || '';

    setContextMenu({
      isOpen: true,
      x: e.pageX,
      y: e.pageY,
      selectedText: text
    });
  };

  return (
    // Envolvemos todo el área en un div que escucha el clic derecho
    <div onContextMenu={handleRightClick} className="min-h-full relative">
      
      <div className="max-w-4xl mx-auto py-16 px-8 md:px-24">
        <div className="group mb-8">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-4 text-neutral-400 mb-4">
            <button className="flex items-center gap-1.5 hover:text-white text-sm transition bg-white/5 px-2 py-1 rounded">
              <SmilePlus size={14} /> Añadir icono
            </button>
            <button className="flex items-center gap-1.5 hover:text-white text-sm transition bg-white/5 px-2 py-1 rounded">
              <ImageIcon size={14} /> Añadir portada
            </button>
          </div>
          
          <h1 
            className="text-5xl font-bold outline-none empty:before:content-['Sin_título'] empty:before:text-neutral-700 text-white cursor-text"
            contentEditable 
            suppressContentEditableWarning
          >
            Notas de Desarrollo
          </h1>
        </div>
        
        <div className="-ml-12">
          <BlockNoteView editor={editor} theme="dark" />
        </div>
      </div>

      {/* EL MENÚ FLOTANTE PERSONALIZADO */}
      {contextMenu.isOpen && (
        <div 
          className="absolute z-50 bg-[#202020] border border-white/10 rounded-lg shadow-2xl py-1 w-64 text-sm text-neutral-300"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {/* Si hay texto seleccionado, mostramos la opción estrella: Crear Hiperhilo */}
          {contextMenu.selectedText ? (
            <button 
              className="w-full flex items-center px-4 py-2 hover:bg-white/10 hover:text-white transition group"
              onClick={() => {
                // Guardamos la palabra que el usuario quiere conectar en Zustand
                setPendingConnectionText(contextMenu.selectedText);
                // Cerramos el menú de clic derecho
                setContextMenu(prev => ({ ...prev, isOpen: false }));
                // Abrimos el buscador global automáticamente
                setSearchOpen(true);
              }}
            >
              <Link2 size={16} className="mr-3 text-red-500 group-hover:text-red-400" />
              Conectar "{contextMenu.selectedText.slice(0, 15)}{contextMenu.selectedText.length > 15 ? '...' : ''}"
            </button>
          ) : (
            <div className="px-4 py-2 text-neutral-500 text-xs italic">
              Selecciona un texto para conectarlo
            </div>
          )}
          
          <div className="h-px bg-white/10 my-1" />
          
          <button className="w-full flex items-center px-4 py-2 hover:bg-white/10 hover:text-white transition">
            <Copy size={16} className="mr-3" /> Copiar
          </button>
          <button className="w-full flex items-center px-4 py-2 hover:bg-white/10 hover:text-white transition text-red-400/80 hover:text-red-400">
            <Scissors size={16} className="mr-3" /> Cortar
          </button>
        </div>
      )}

    </div>
  );
}
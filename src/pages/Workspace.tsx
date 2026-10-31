import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { Image as ImageIcon, SmilePlus, Link2, Copy, Scissors, Plus, X } from 'lucide-react';
import { useState, useEffect } from 'react';
// Importamos el estado global
import { useAppStore } from '../store/useAppStore';

// ============================================================================
// SUBCOMPONENTE: Este es el panel individual. Se puede clonar hasta 3 veces.
// ============================================================================
function EditorPanel({ onRemove, canRemove }: { onRemove: () => void, canRemove: boolean }) {
  // Cada panel tiene su propia instancia independiente del editor
  const editor = useCreateBlockNote({
    initialContent: [
      { type: "paragraph", content: "" },
      { type: "paragraph" }
    ]
  });

  return (
    <div className="flex-1 min-w-[400px] max-w-2xl bg-black/40 backdrop-blur-md border border-white/10 rounded-xl p-8 relative group transition-all shadow-xl">
      {/* Botón de cierre (aparece al pasar el mouse si hay más de 1 panel) */}
      {canRemove && (
        <button
          onClick={onRemove}
          className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 p-2 bg-red-500/20 hover:bg-red-500 text-white rounded transition z-10"
          title="Cerrar panel"
        >
          <X size={16} />
        </button>
      )}

      <div className="group/title mb-8">
        <div className="opacity-0 group-hover/title:opacity-100 transition-opacity flex items-center gap-4 text-neutral-400 mb-4">
          <button className="flex items-center gap-1.5 hover:text-white text-sm transition bg-white/5 px-2 py-1 rounded">
            <SmilePlus size={14} /> Añadir icono
          </button>
          <button className="flex items-center gap-1.5 hover:text-white text-sm transition bg-white/5 px-2 py-1 rounded">
            <ImageIcon size={14} /> Añadir portada
          </button>
        </div>
        
        <h1 
          className="text-4xl font-bold outline-none empty:before:content-['Sin_título'] empty:before:text-neutral-700 text-white cursor-text bg-transparent border-none"
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
  );
}


// ============================================================================
// COMPONENTE PRINCIPAL: Maneja la cuadrícula, los hasta 3 paneles y el Menú
// ============================================================================
export default function Workspace() {
  const { setPendingConnectionText, setSearchOpen } = useAppStore();

  // Estado para los paneles activos (empezamos con 1)
  const [panels, setPanels] = useState([{ id: Date.now() }]);

  // Lógica de paneles
  const addPanel = () => {
    if (panels.length < 3) {
      setPanels([...panels, { id: Date.now() }]);
    }
  };
  const removePanel = (idToRemove: number) => {
    setPanels(panels.filter(p => p.id !== idToRemove));
  };

  // --------------------------------------------------------------------------
  // LÓGICA DEL MENÚ DE CLIC DERECHO (Intacta)
  // --------------------------------------------------------------------------
  const [contextMenu, setContextMenu] = useState({
    isOpen: false,
    x: 0,
    y: 0,
    selectedText: ''
  });

  useEffect(() => {
    const closeMenu = () => setContextMenu(prev => ({ ...prev, isOpen: false }));
    document.addEventListener('click', closeMenu);
    return () => document.removeEventListener('click', closeMenu);
  }, []);

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const text = window.getSelection()?.toString().trim() || '';
    setContextMenu({
      isOpen: true,
      x: e.pageX,
      y: e.pageY,
      selectedText: text
    });
  };

  return (
    // El onContextMenu sigue en el div padre, protegiendo todos los paneles clonados
    <div onContextMenu={handleRightClick} className="min-h-full p-8 flex gap-6 overflow-x-auto items-start relative">
      
      {/* RENDERIZAMOS LOS PANELES ACTIVOS */}
      {panels.map(panel => (
        <EditorPanel
          key={panel.id}
          onRemove={() => removePanel(panel.id)}
          canRemove={panels.length > 1}
        />
      ))}

      {/* BOTÓN PARA AÑADIR OTRO PANEL (Se oculta al llegar a 3) */}
      {panels.length < 3 && (
        <button
          onClick={addPanel}
          className="min-w-[80px] h-[200px] mt-[100px] flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 border-dashed text-white/30 hover:text-white transition shrink-0"
          title="Agregar nuevo editor al lado"
        >
          <Plus size={32} />
        </button>
      )}

      {/* EL MENÚ FLOTANTE PERSONALIZADO DE HIPERHILOS */}
      {contextMenu.isOpen && (
        <div 
          className="fixed z-50 bg-[#202020] border border-white/10 rounded-lg shadow-2xl py-1 w-64 text-sm text-neutral-300"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.selectedText ? (
            <button 
              className="w-full flex items-center px-4 py-2 hover:bg-white/10 hover:text-white transition group"
              onClick={() => {
                setPendingConnectionText(contextMenu.selectedText);
                setContextMenu(prev => ({ ...prev, isOpen: false }));
                setSearchOpen(true);
              }}
            >
              <Link2 size={16} className="mr-3 text-red-500 group-hover:text-red-400 shrink-0" />
              <span className="truncate">Conectar "{contextMenu.selectedText}"</span>
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
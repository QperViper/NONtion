import { Command } from 'cmdk';
import { useEffect } from 'react';
import { FolderGit2, Home, Search, PenTool, Link2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useNavigate } from 'react-router-dom';
import '../../index.css';

export default function SearchModal() {
  const { 
    isSearchOpen, 
    setSearchOpen, 
    pendingConnectionText, 
    setPendingConnectionText,
    addConnection 
  } = useAppStore();
  
  const navigate = useNavigate();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen(!isSearchOpen);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setPendingConnectionText(null); // Cancelar conexión si presiona Esc
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [isSearchOpen, setSearchOpen, setPendingConnectionText]);

  if (!isSearchOpen) return null;

  // Función que se ejecuta cuando elijes un destino
  const handleSelectDestination = (title: string, path: string) => {
    if (pendingConnectionText) {
      // 1. Crear el hiperhilo
      addConnection({
        id: Date.now().toString(),
        sourceText: pendingConnectionText,
        destinationTitle: title,
        destinationPath: path
      });
      // 2. Limpiar estado y cerrar
      setPendingConnectionText(null);
      setSearchOpen(false);
    } else {
      // Navegación normal si no estamos conectando nada
      navigate(path);
      setSearchOpen(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => {
        setSearchOpen(false);
        setPendingConnectionText(null);
      }}/>
      
      <Command className="relative w-full max-w-2xl bg-[#1c1c1c] border border-white/10 rounded-xl shadow-2xl overflow-hidden text-neutral-200">
        
        {/* Banner que avisa que estamos en "Modo Conexión" */}
        {pendingConnectionText && (
          <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 flex items-center text-red-400 text-sm">
            <Link2 size={16} className="mr-2" />
            <span>¿A dónde quieres conectar la palabra <strong>"{pendingConnectionText}"</strong>?</span>
          </div>
        )}

        <div className="flex items-center px-4 py-3 border-b border-white/10">
          <Search className="w-5 h-5 text-neutral-400 mr-3" />
          <Command.Input 
            autoFocus
            placeholder={pendingConnectionText ? "Busca el destino..." : "Buscar páginas, tableros o hiperhilos..."}
            className="w-full bg-transparent outline-none text-[15px] placeholder:text-neutral-500"
          />
        </div>

        <Command.List className="max-h-[60vh] overflow-y-auto p-2 scrollbar-hide">
          <Command.Empty className="py-6 text-center text-sm text-neutral-500">
            No se encontraron resultados.
          </Command.Empty>

          <Command.Group heading="Vistas Principales" className="px-2 py-1.5 text-xs font-semibold text-neutral-500">
            <Command.Item 
              onSelect={() => handleSelectDestination('Inicio', '/')}
              className="flex items-center px-3 py-2.5 rounded-md text-sm cursor-pointer aria-selected:bg-white/10 transition-colors"
            >
              <Home className="w-4 h-4 mr-3 text-neutral-400" /> Inicio
            </Command.Item>
            <Command.Item 
              onSelect={() => handleSelectDestination('Pizarra Infinita', '/pizarra')}
              className="flex items-center px-3 py-2.5 rounded-md text-sm cursor-pointer aria-selected:bg-white/10 transition-colors"
            >
              <PenTool className="w-4 h-4 mr-3 text-blue-400" /> Pizarra Infinita
            </Command.Item>
          </Command.Group>

          <Command.Group heading="Documentos" className="px-2 py-1.5 text-xs font-semibold text-neutral-500 mt-2">
            <Command.Item 
              onSelect={() => handleSelectDestination('Proyectos UTFSM', '/doc/utfsm')}
              className="flex items-center px-3 py-2.5 rounded-md text-sm cursor-pointer aria-selected:bg-white/10 transition-colors"
            >
              <FolderGit2 className="w-4 h-4 mr-3 text-neutral-400" /> Proyectos UTFSM
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
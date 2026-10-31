import { FileText, FolderGit2, Home, Search, PlusCircle, Settings, PenTool, Link2 } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { useState, useEffect, useCallback } from 'react';

export default function Sidebar({ onOpenSettings, onOpenSearch }: { onOpenSettings?: () => void, onOpenSearch?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { connections, sidebarWidth, setSidebarWidth } = useAppStore(); 
  
  // Estado para saber si el usuario está arrastrando el borde
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback(() => setIsResizing(true), []);
  const stopResizing = useCallback(() => setIsResizing(false), []);

const resize = useCallback((e: MouseEvent) => {
    if (isResizing) {
      // Mínimo 60px (se esconde el texto, quedan los íconos), máximo casi toda la pantalla
      if (e.clientX >= 60 && e.clientX <= window.innerWidth - 60) {
        setSidebarWidth(e.clientX);
      }
    }
  }, [isResizing, setSidebarWidth]);

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  return (
    <aside 
      // Quitamos w-64 y agregamos transition-none al redimensionar para que sea fluido
      className={`bg-[#202020] border-r border-white/5 flex flex-col z-50 relative ${
        isResizing ? 'select-none transition-none' : 'transition-all duration-300'
      }`}
      style={{ width: sidebarWidth }}
    >
      {/* TIRADOR DE ARRASTRE OCULTO EN EL BORDE */}
      <div 
        onMouseDown={startResizing}
        className="absolute top-0 -right-1 w-2 h-full cursor-col-resize hover:bg-red-500/50 active:bg-red-500 z-50 transition-colors"
      />

      <div className="p-4 flex items-center gap-2 hover:bg-white/5 cursor-pointer transition">
        <div className="w-5 h-5 rounded bg-red-500 flex items-center justify-center font-bold text-[10px]">N</div>
        <span className="font-medium text-sm truncate">Espacio de Nicolás</span>
      </div>
      
      <div className="px-2 pb-4 space-y-0.5">
        <SidebarItem icon={<Search size={16} />} label="Buscar (Ctrl+K)" onClick={onOpenSearch} />
        <SidebarItem icon={<Settings size={16} />} label="Configuración" onClick={onOpenSettings} />
        <SidebarItem icon={<PlusCircle size={16} />} label="Nueva página" />
      </div>

      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto scrollbar-hide">
        <div className="text-xs font-semibold text-neutral-500 px-2 mt-4 mb-2">VISTAS</div>
        <SidebarItem icon={<Home size={16} />} label="Inicio (Editor)" active={location.pathname === '/'} onClick={() => navigate('/')} />
        <SidebarItem icon={<PenTool size={16} />} label="Pizarra Infinita" active={location.pathname === '/pizarra'} onClick={() => navigate('/pizarra')} />

        <div className="text-xs font-semibold text-neutral-500 px-2 mt-6 mb-2">HILOS ACTIVOS</div>
        {connections.length === 0 ? (
          <div className="px-4 py-2 text-xs text-neutral-600 italic">Sin conexiones aún</div>
        ) : (
          connections.map(conn => (
            <SidebarItem 
              key={conn.id}
              icon={<Link2 size={16} className="text-red-500 shrink-0" />} 
              label={`${conn.sourceText} → ${conn.destinationTitle}`}
              onClick={() => navigate(conn.destinationPath)}
            />
          ))
        )}

        <div className="text-xs font-semibold text-neutral-500 px-2 mt-6 mb-2">FAVORITOS</div>
        <SidebarItem icon={<FolderGit2 size={16} />} label="Proyectos UTFSM" />
        <SidebarItem icon={<FileText size={16} />} label="AltoChef Backend" />
      </nav>
    </aside>
  );
}

function SidebarItem({ icon, label, active = false, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void; }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left ${
        active ? 'bg-white/10 text-white font-medium' : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-200'
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
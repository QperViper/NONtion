import { FileText, FolderGit2, Home, Search, PlusCircle, Settings, PenTool } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

export default function Sidebar({ onOpenSettings, onOpenSearch }: { onOpenSettings?: () => void, onOpenSearch?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation(); // Para saber en qué página estamos y marcar el botón activo

  return (
    <aside className="w-64 bg-[#202020] border-r border-white/5 flex flex-col transition-all duration-300 z-50 relative">
      <div className="p-4 flex items-center gap-2 hover:bg-white/5 cursor-pointer transition">
        <div className="w-5 h-5 rounded bg-red-500 flex items-center justify-center font-bold text-[10px]">
          N
        </div>
        <span className="font-medium text-sm truncate">Espacio de Nicolás</span>
      </div>
      
      <div className="px-2 pb-4 space-y-0.5">
        <SidebarItem icon={<Search size={16} />} label="Buscar (Ctrl+K)" onClick={onOpenSearch} />
        <SidebarItem icon={<Settings size={16} />} label="Configuración" onClick={onOpenSettings} />
        <SidebarItem icon={<PlusCircle size={16} />} label="Nueva página" />
      </div>

      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        <div className="text-xs font-semibold text-neutral-500 px-2 mt-4 mb-2">VISTAS</div>
        
        {/* Botón para ir al editor de texto */}
        <SidebarItem 
          icon={<Home size={16} />} 
          label="Inicio (Editor)" 
          active={location.pathname === '/'} 
          onClick={() => navigate('/')} 
        />
        
        {/* Botón para ir a la pizarra infinita */}
        <SidebarItem 
          icon={<PenTool size={16} />} 
          label="Pizarra Infinita" 
          active={location.pathname === '/pizarra'} 
          onClick={() => navigate('/pizarra')} 
        />

        <div className="text-xs font-semibold text-neutral-500 px-2 mt-6 mb-2">FAVORITOS</div>
        <SidebarItem icon={<FolderGit2 size={16} />} label="Proyectos UTFSM" />
        <SidebarItem icon={<FileText size={16} />} label="AltoChef Backend" />
      </nav>
    </aside>
  );
}

function SidebarItem({ 
  icon, 
  label, 
  active = false, 
  onClick 
}: { 
  icon: React.ReactNode; 
  label: string; 
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
        active ? 'bg-white/10 text-white font-medium' : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-200'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
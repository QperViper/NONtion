import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useState } from 'react';
import Sidebar from './components/layout/Sidebar';
import Workspace from './pages/Workspace';
import Whiteboard from './pages/Whiteboard';
import SettingsPanel from './components/layout/SettingsPanel';
import SearchModal from './components/layout/SearchModal';
import { useAppStore } from './store/useAppStore';

export default function App() {
  // Ahora extraemos 'setSearchOpen' directamente de nuestro cerebro global
  const { themeColor, bgImage, setSearchOpen } = useAppStore();
  
  // Solo mantenemos el estado local para el panel de configuración
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <BrowserRouter>
      <div 
        className="flex h-screen text-white overflow-hidden font-sans transition-all duration-500 bg-cover bg-center"
        style={{ 
          backgroundColor: themeColor,
          backgroundImage: bgImage ? `url(${bgImage})` : 'none'
        }}
      >
        <Sidebar 
          onOpenSettings={() => setIsSettingsOpen(true)} 
          // Conectamos el botón de la barra lateral directo al estado global
          onOpenSearch={() => setSearchOpen(true)}
        />
        
        <main className="flex-1 overflow-y-auto bg-black/20 backdrop-blur-[2px] relative">
          <Routes>
            <Route path="/" element={<Workspace />} />
            <Route path="/pizarra" element={<Whiteboard />} />
          </Routes>
        </main>

        {isSettingsOpen && <SettingsPanel onClose={() => setIsSettingsOpen(false)} />}
        
        {/* El buscador ahora es 100% independiente sin props (propiedades) */}
        <SearchModal />
      </div>
    </BrowserRouter>
  );
}
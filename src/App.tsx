import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useState } from 'react';
import Sidebar from './components/layout/Sidebar';
import Workspace from './pages/Workspace';
import Whiteboard from './pages/Whiteboard';
import SettingsPanel from './components/layout/SettingsPanel';
import SearchModal from './components/layout/SearchModal';
import { useAppStore } from './store/useAppStore';

export default function App() {
  const { themeColor, bgImage, bgBlur, bgBloom, setSearchOpen } = useAppStore();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <BrowserRouter>
      <div className="h-screen w-full text-white overflow-hidden font-sans relative" style={{ backgroundColor: themeColor }}>
        
        {/* FONDO AISLADO */}
        {bgImage && (
          <div 
            className="absolute inset-0 z-0 bg-cover bg-center transition-all duration-300"
            style={{ 
              backgroundImage: `url(${bgImage})`,
              filter: `blur(${bgBlur}px) brightness(${bgBloom}%)`,
              transform: 'scale(1.05)'
            }}
          />
        )}

        <div className="relative z-10 flex h-full w-full">
          <Sidebar 
            // AQUÍ ESTÁ LA MAGIA: El "!" invierte el estado actual cada vez que haces clic
            onOpenSettings={() => setIsSettingsOpen(!isSettingsOpen)} 
            onOpenSearch={() => setSearchOpen(true)}
          />
          
          <main className="flex-1 overflow-y-auto bg-black/40">
            <Routes>
              <Route path="/" element={<Workspace />} />
              <Route path="/pizarra" element={<Whiteboard />} />
            </Routes>
          </main>
        </div>

        {isSettingsOpen && <SettingsPanel onClose={() => setIsSettingsOpen(false)} />}
        <SearchModal />
      </div>
    </BrowserRouter>
  );
}
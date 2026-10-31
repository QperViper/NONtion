import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Sidebar from './components/layout/Sidebar';
import Workspace from './pages/Workspace';
import Whiteboard from './pages/Whiteboard'; // Importamos la pizarra
import SettingsPanel from './components/layout/SettingsPanel';
import SearchModal from './components/layout/SearchModal';
import { useAppStore } from './store/useAppStore';

export default function App() {
  const { themeColor, bgImage } = useAppStore();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsSearchOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

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
          onOpenSearch={() => setIsSearchOpen(true)}
        />
        
        <main className="flex-1 overflow-y-auto bg-black/20 backdrop-blur-[2px] relative">
          <Routes>
            <Route path="/" element={<Workspace />} />
            {/* Agregamos la ruta de la pizarra */}
            <Route path="/pizarra" element={<Whiteboard />} />
          </Routes>
        </main>

        {isSettingsOpen && <SettingsPanel onClose={() => setIsSettingsOpen(false)} />}
        <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      </div>
    </BrowserRouter>
  );
}
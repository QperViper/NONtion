import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Hiperhilo {
  id: string;
  sourceText: string;
  destinationTitle: string;
  destinationPath: string;
}

interface AppState {
  themeColor: string;
  bgImage: string | null;
  bgBlur: number;      
  bgBloom: number;     
  
  // NUEVAS VARIABLES PARA EL ANCHO DE LOS PANELES
  sidebarWidth: number;
  settingsWidth: number;

  setThemeColor: (color: string) => void;
  setBgImage: (url: string | null) => void;
  setBgBlur: (blur: number) => void;     
  setBgBloom: (bloom: number) => void;   
  
  // NUEVAS FUNCIONES DE ACTUALIZACIÓN
  setSidebarWidth: (width: number) => void;
  setSettingsWidth: (width: number) => void;

  isSearchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  pendingConnectionText: string | null;
  setPendingConnectionText: (text: string | null) => void;
  connections: Hiperhilo[];
  addConnection: (connection: Hiperhilo) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      themeColor: '#191919',
      bgImage: null,
      bgBlur: 2,     
      bgBloom: 100,  
      
      // ANCHOS POR DEFECTO EN PÍXELES
      sidebarWidth: 256, // equivalente a w-64
      settingsWidth: 320, // equivalente a w-80

      setThemeColor: (color) => set({ themeColor: color, bgImage: null }),
      setBgImage: (url) => set({ bgImage: url }),
      setBgBlur: (blur) => set({ bgBlur: blur }),
      setBgBloom: (bloom) => set({ bgBloom: bloom }),
      
      setSidebarWidth: (width) => set({ sidebarWidth: width }),
      setSettingsWidth: (width) => set({ settingsWidth: width }),

      isSearchOpen: false,
      setSearchOpen: (open) => set({ isSearchOpen: open }),
      pendingConnectionText: null,
      setPendingConnectionText: (text) => set({ pendingConnectionText: text }),
      connections: [],
      addConnection: (connection) => set((state) => ({ 
        connections: [...state.connections, connection] 
      })),
    }),
    { name: 'app-config' }
  )
);
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Definimos cómo se ve un "Hiperhilo"
export interface Hiperhilo {
  id: string;
  sourceText: string;
  destinationTitle: string;
  destinationPath: string;
}

interface AppState {
  themeColor: string;
  bgImage: string | null;
  setThemeColor: (color: string) => void;
  setBgImage: (url: string | null) => void;

  // Control del buscador
  isSearchOpen: boolean;
  setSearchOpen: (open: boolean) => void;

  // Lógica de Hiperhilos
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
      setThemeColor: (color) => set({ themeColor: color, bgImage: null }),
      setBgImage: (url) => set({ bgImage: url }),

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
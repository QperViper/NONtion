import { useAppStore } from '../../store/useAppStore';
import { Image as ImageIcon, Palette, X } from 'lucide-react';
import { useState } from 'react';

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { setThemeColor, setBgImage, themeColor } = useAppStore();
  const [imageUrl, setImageUrl] = useState('');

  // Algunos colores predefinidos para probar
  const presetColors = ['#191919', '#0f172a', '#312e81', '#450a0a', '#064e3b'];

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-[#1e1e1e] border-l border-white/10 p-6 shadow-2xl z-50 flex flex-col gap-6 text-white">
      <div className="flex justify-between items-center">
        <h2 className="font-bold flex items-center gap-2"><Palette size={18} /> Apariencia</h2>
        <button onClick={onClose} className="hover:bg-white/10 p-1 rounded transition"><X size={18} /></button>
      </div>

      {/* Selector de Colores Sólidos */}
      <div>
        <label className="text-xs font-semibold text-neutral-400 mb-3 block">COLORES SÓLIDOS</label>
        <div className="flex gap-2 flex-wrap">
          {presetColors.map((color) => (
            <button
              key={color}
              onClick={() => setThemeColor(color)}
              className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 ${
                themeColor === color && !useAppStore.getState().bgImage ? 'border-white' : 'border-transparent'
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
          <input 
            type="color" 
            onChange={(e) => setThemeColor(e.target.value)}
            className="w-8 h-8 rounded-full cursor-pointer bg-transparent border-0 p-0"
            title="Color personalizado"
          />
        </div>
      </div>

      {/* Selector de Imagen de Fondo */}
      <div>
        <label className="text-xs font-semibold text-neutral-400 mb-3 flex items-center gap-2">
          <ImageIcon size={14} /> IMAGEN DE FONDO
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Pega la URL de una imagen..."
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            className="flex-1 bg-black/50 border border-white/10 rounded px-3 py-1.5 text-sm outline-none focus:border-red-500 transition"
          />
          <button 
            onClick={() => setBgImage(imageUrl)}
            className="bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded text-sm transition"
          >
            Aplicar
          </button>
        </div>
        <button 
          onClick={() => setBgImage(null)}
          className="text-xs text-red-400 mt-2 hover:underline"
        >
          Quitar imagen
        </button>
      </div>
    </div>
  );
}
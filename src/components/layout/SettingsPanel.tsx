import { useAppStore } from '../../store/useAppStore';
import { Image as ImageIcon, Palette, X, Upload } from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { setThemeColor, setBgImage, themeColor, bgImage, bgBlur, setBgBlur, bgBloom, setBgBloom, settingsWidth, setSettingsWidth } = useAppStore();
  const [imageUrl, setImageUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Estado para controlar el redimensionamiento del panel derecho
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback(() => setIsResizing(true), []);
  const stopResizing = useCallback(() => setIsResizing(false), []);

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing) {
      const newWidth = window.innerWidth - e.clientX;
      // Mínimo 100px, máximo casi toda la pantalla
      if (newWidth >= 100 && newWidth <= window.innerWidth - 60) {
        setSettingsWidth(newWidth);
      }
    }
  }, [isResizing, setSettingsWidth]);

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  const presetColors = [
    '#191919', '#1e293b', '#312e81', '#4a044e', '#7f1d1d',
    '#064e3b', '#14532d', '#b45309', '#0f766e', '#1d4ed8'
  ];

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setBgImage(reader.result as string);
        e.target.value = ''; 
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div 
      className={`fixed right-0 top-0 h-full bg-[#1e1e1e] border-l border-white/10 p-6 shadow-2xl z-50 flex flex-col gap-6 text-white overflow-y-auto ${
        isResizing ? 'select-none transition-none' : 'transition-all duration-300'
      }`}
      style={{ width: settingsWidth }}
    >
      {/* TIRADOR DE ARRASTRE EN EL BORDE IZQUIERDO */}
      <div 
        onMouseDown={startResizing}
        className="absolute top-0 -left-1 w-2 h-full cursor-col-resize hover:bg-red-500/50 active:bg-red-500 z-50 transition-colors"
      />

      <div className="flex justify-between items-center">
        <h2 className="font-bold flex items-center gap-2"><Palette size={18} /> Apariencia</h2>
        <button onClick={onClose} className="hover:bg-white/10 p-1 rounded transition"><X size={18} /></button>
      </div>

      {/* Selector de Colores Sólidos */}
      <div>
        <label className="text-xs font-semibold text-neutral-400 mb-3 block">COLORES RÁPIDOS</label>
        <div className="flex gap-2 flex-wrap mb-4">
          {presetColors.map((color) => (
            <button
              key={color}
              onClick={() => setThemeColor(color)}
              className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 ${
                themeColor === color && !bgImage ? 'border-white' : 'border-transparent'
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>

        <label className="text-xs font-semibold text-neutral-400 mb-2 block">COLOR RGB PERSONALIZADO</label>
        <div className="flex items-center gap-3 p-2 bg-black/20 rounded border border-white/5">
          <input 
            type="color" 
            value={themeColor}
            onChange={(e) => setThemeColor(e.target.value)}
            className="w-10 h-10 rounded cursor-pointer bg-transparent border-0 p-0"
            title="Abrir paleta RGB"
          />
          <span className="text-sm text-neutral-300">Haz clic para elegir color</span>
        </div>
      </div>

      <div className="h-px bg-white/10 w-full my-2" />

      {/* Selector de Imagen de Fondo */}
      <div>
        <label className="text-xs font-semibold text-neutral-400 mb-4 flex items-center gap-2">
          <ImageIcon size={14} /> IMAGEN DE FONDO
        </label>
        
        <div className="mb-4">
          <input 
            type="file" 
            accept="image/*"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 p-2.5 rounded text-sm transition shrink-0"
          >
            <Upload size={16} /> Subir desde tu PC
          </button>
        </div>

        <div className="text-xs text-neutral-500 text-center mb-4">- O pega un enlace -</div>

        <div className="flex gap-2 mb-2">
          <input
            type="text"
            placeholder="URL de la imagen..."
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            className="flex-1 w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-sm outline-none focus:border-red-500 transition"
          />
          <button 
            onClick={() => {
              if(imageUrl) setBgImage(imageUrl);
              setImageUrl('');
            }}
            className="bg-white/10 hover:bg-white/20 px-3 py-2 rounded text-sm transition font-medium shrink-0"
          >
            Aplicar
          </button>
        </div>

        {/* AJUSTES DINÁMICOS */}
        {bgImage && (
          <div className="mt-6 space-y-5 bg-black/20 p-4 rounded-lg border border-white/5">
            <div>
              <div className="flex justify-between text-xs font-semibold text-neutral-400 mb-2">
                <label>DESENFOQUE</label>
                <span>{bgBlur}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="20"
                value={bgBlur}
                onChange={(e) => setBgBlur(Number(e.target.value))}
                className="w-full accent-red-500 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
              />
            </div>
            
            <div>
              <div className="flex justify-between text-xs font-semibold text-neutral-400 mb-2">
                <label>BLOOM (BRILLO)</label>
                <span>{bgBloom}%</span>
              </div>
              <input
                type="range"
                min="50"
                max="200"
                value={bgBloom}
                onChange={(e) => setBgBloom(Number(e.target.value))}
                className="w-full accent-red-500 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <button 
              onClick={() => setBgImage(null)}
              className="w-full mt-4 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded transition border border-red-500/20 shrink-0"
            >
              Quitar fondo actual
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
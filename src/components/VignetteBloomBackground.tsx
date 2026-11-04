import { useEffect, useEffectEvent, useRef } from 'react';
import { AsciiRenderer } from '../effects/ascii-renderer';
import { vignetteBloomParameters, vignetteBloomSource } from '../effects/vignette-bloom';

export default function VignetteBloomBackground({ paused = false, className = '', onError }: {
  paused?: boolean; className?: string; onError?: (message: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reportError = useEffectEvent((message: string) => onError?.(message));
  useEffect(() => {
    const canvas = canvasRef.current!;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let renderer: AsciiRenderer | null = null, frame = 0, resizeFrame = 0;
    let disposed = false, visible = true, failed = false, time = 0, lastTick = 0, lastDraw = 0;
    let lastWidth = 0, lastHeight = 0, lastDpr = 0;
    const canAnimate = () => !disposed && !failed && !paused && !media.matches && !document.hidden && visible;
    const draw = () => {
      if (failed) return;
      try { renderer?.render(paused || media.matches ? 0 : time); }
      catch { failed = true; cancelAnimationFrame(frame); reportError('No se pudo dibujar Vignette Bloom en este navegador. Puedes elegir otro fondo en Apariencia.'); }
    };
    const tick = (now: number) => {
      if (!canAnimate()) return;
      time += lastTick ? Math.min(.1, (now - lastTick) / 1000) : 0; lastTick = now;
      if (now - lastDraw >= 1000 / 30) { draw(); lastDraw = now; }
      frame = requestAnimationFrame(tick);
    };
    const reconcile = () => {
      cancelAnimationFrame(frame); lastTick = 0;
      if (!document.hidden && visible) draw();
      if (canAnimate()) frame = requestAnimationFrame(tick);
    };
    const resize = () => {
      if (!renderer || disposed) return;
      const { width, height } = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      if (width === lastWidth && height === lastHeight && dpr === lastDpr) return;
      lastWidth = width; lastHeight = height; lastDpr = dpr;
      renderer.resize(width, height, dpr); draw();
    };
    const scheduleResize = () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(resize); };
    const observer = new ResizeObserver(scheduleResize); observer.observe(canvas);
    const intersection = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? true; reconcile();
    });
    intersection.observe(canvas);
    document.addEventListener('visibilitychange', reconcile);
    media.addEventListener('change', reconcile); window.addEventListener('resize', scheduleResize);
    const photo = new Image(); photo.decoding = 'async'; photo.src = vignetteBloomSource;
    void photo.decode().then(async () => {
      if (disposed) return;
      const instance = new AsciiRenderer(canvas, photo, photo.naturalWidth, photo.naturalHeight, vignetteBloomParameters);
      await instance.prepareMask();
      if (disposed) { instance.dispose(); return; }
      renderer = instance; resize(); reconcile();
    }).catch(() => {
      if (!disposed) reportError('No se pudo cargar la foto de Vignette Bloom. Revisa los archivos de la aplicación.');
    });
    return () => {
      disposed = true; cancelAnimationFrame(frame); cancelAnimationFrame(resizeFrame);
      observer.disconnect(); intersection.disconnect();
      document.removeEventListener('visibilitychange', reconcile); media.removeEventListener('change', reconcile);
      window.removeEventListener('resize', scheduleResize); renderer?.dispose();
    };
  }, [paused]);
  return <canvas ref={canvasRef} className={className} aria-hidden="true" data-effect="vignette-bloom" />;
}

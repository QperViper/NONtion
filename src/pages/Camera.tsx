import { useCallback, useEffect, useState } from 'react';
import { renderSVG } from 'uqr';
import { Cable, FolderOpen, Image as ImageIcon, Power, Smartphone, Video, Wifi } from 'lucide-react';
import { request } from '../lib/api';

interface CaptureFile { file: string; name: string; kind: 'image' | 'video'; bytes: number; at: number; }
interface Status {
  active: boolean; port: number; dir: string; path: string | null;
  addresses: { label: string; iface: string; url: string }[]; files: CaptureFile[];
}

const size = (b: number) => b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
const fileUrl = (f: CaptureFile) => `/api/capture/file?path=${encodeURIComponent(f.file)}`;
// Brave/Chrome no muestran HEIC: se ve un ícono (el archivo queda intacto en FONion).
const previewable = (f: CaptureFile) => f.kind === 'video' || !/\.(heic|heif)$/i.test(f.name);

/** Cámara del celular → carpeta FONion de este equipo. */
export default function Camera() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const load = useCallback(async () => {
    try { setStatus(await request<Status>('/capture')); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  // Mientras la página está abierta: se refresca cada 2 s (llegan fotos) y mantiene viva la recepción.
  useEffect(() => {
    const first = setTimeout(() => { void load(); }, 0);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 2000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [load]);
  const toggle = async () => {
    setBusy(true);
    try { setStatus(await request<Status>(`/capture/${status?.active ? 'stop' : 'start'}`, { method: 'POST', body: '{}' })); setSelected(0); setError(null); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const address = status?.addresses[selected] ?? status?.addresses[0];

  return <div className="camera-page">
    <header className="calendar-header">
      <h1>Cámara del celular</h1>
      <button className={`soft-button ${status?.active ? 'event-danger' : 'event-primary'}`} disabled={busy || !status} onClick={() => void toggle()}>
        <Power size={15}/> {status?.active ? 'Detener recepción' : 'Recibir fotos y videos'}
      </button>
    </header>
    {error && <p className="event-error" role="alert">{error}</p>}

    {status?.active ? <section className="net-card cam-pair">
      {address ? <>
        <div className="cam-qr" role="img" aria-label="Código QR para abrir la página de envío en el celular" dangerouslySetInnerHTML={{ __html: renderSVG(address.url, { border: 1, pixelSize: 6, whiteColor: '#ffffff', blackColor: '#111111' }) }}/>
        <div className="cam-steps">
          <h2>Escanea el código con la cámara del iPhone</h2>
          <ol>
            <li><b>Por cable:</b> conecta el iPhone y activa <b>Ajustes → Compartir Internet</b>. <b>O</b> conéctalo a la misma Wi-Fi que este equipo.</li>
            <li>Abre la <b>Cámara</b> del iPhone, apunta al código y toca el enlace (se abre en Safari).</li>
            <li>Toca <b>Tomar foto o video</b> o <b>Elegir de Fotos</b>. Llega aquí y a la carpeta FONion.</li>
          </ol>
          {status.addresses.length > 1 && <div className="cam-nets" role="radiogroup" aria-label="Red">
            {status.addresses.map((a, i) => <button key={a.url} role="radio" aria-checked={a === address} className={`net-chip${a === address ? ' is-selected' : ''}`} onClick={() => setSelected(i)}>
              {a.label.startsWith('iPhone') ? <Cable size={12}/> : <Wifi size={12}/>}{a.label}</button>)}
          </div>}
          <p className="cam-url">{address.url.replace(/\/c\/.+$/, '/c/…')} · {address.iface}</p>
          <p className="net-foot">Se apaga sola tras 15 minutos sin uso. La primera vez, Windows preguntará si permite que Node.js use la red: acepta (incluida la opción de redes públicas, porque la red del cable del iPhone suele quedar como pública).</p>
        </div>
      </> : <p>Este equipo no tiene ninguna red activa. Conecta el iPhone por cable con <b>Compartir Internet</b> activado, o conéctate a una Wi-Fi, y la dirección aparecerá aquí.</p>}
    </section> : status && <section className="net-card cam-off">
      <Smartphone size={22}/>
      <p>Usa el iPhone (o cualquier celular) como cámara: las fotos y videos se guardan <b>directo en este equipo</b>, sin pasar por internet ni por Supabase.</p>
    </section>}

    <section className="cam-received">
      <div className="cam-received-head">
        <h3 className="nav-heading">RECIBIDOS</h3>
        <button className="quiet-button" onClick={() => void request('/capture/open-folder', { method: 'POST', body: '{}' })} title={status?.dir}><FolderOpen size={14}/> Abrir carpeta FONion</button>
      </div>
      {status && !status.files.length && <p className="net-hint">Todavía no hay fotos ni videos. Se guardan en <code>{status.dir}</code>.</p>}
      <ul className="cam-grid">
        {status?.files.map(f => <li key={f.file}>
          <a href={fileUrl(f)} target="_blank" rel="noopener noreferrer" className="cam-thumb" title={f.name}>
            {previewable(f) ? (f.kind === 'video'
              ? <video src={`${fileUrl(f)}#t=0.1`} preload="metadata" muted playsInline/>
              : <img src={fileUrl(f)} alt="" loading="lazy"/>)
              : <span className="cam-icon"><ImageIcon size={26}/>HEIC</span>}
            {f.kind === 'video' && <span className="cam-badge"><Video size={12}/></span>}
          </a>
          <span className="cam-meta">{new Date(f.at).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {size(f.bytes)}</span>
        </li>)}
      </ul>
    </section>
  </div>;
}

import { useCallback, useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';
import { request } from '../lib/api';
import { POLL_MS, STATUS_EVENT, syncNow } from '../lib/sync';
import type { SyncStatus } from '../lib/sync';
import ControlButton from './ControlButton';

function ago(iso: string | null) {
  if (!iso) return 'nunca';
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  return new Date(iso).toLocaleString('es', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
}

export default function SyncIndicator() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  // busy se activa/desactiva con los avisos de syncNow (botón o atajo).

  const poll = useCallback(async () => {
    try { setStatus(await request<SyncStatus>('/sync')); } catch { /* el servidor local no responde: la app ya lo indica */ }
  }, []);
  const run = useCallback(async () => {
    try { await syncNow(); } catch { setBusy(false); await poll(); }
  }, [poll]);

  useEffect(() => {
    const first = setTimeout(() => { void poll(); }, 0);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void poll(); }, POLL_MS);
    // El atajo lo atiende App (funciona aunque la barra lateral esté cerrada); aquí solo se refleja el estado.
    const update = (e: Event) => { const detail = (e as CustomEvent<SyncStatus | null>).detail; setBusy(!detail); if (detail) setStatus(detail); };
    window.addEventListener(STATUS_EVENT, update);
    return () => { clearTimeout(first); clearInterval(timer); window.removeEventListener(STATUS_EVENT, update); };
  }, [poll, run]);

  if (!status || status.state === 'disabled') return null;
  const syncing = busy || status.running;
  const label = syncing ? 'Sincronizando…'
    : status.state === 'offline' ? `Sin conexión${status.pending ? ` · ${status.pending} pendiente${status.pending === 1 ? '' : 's'}` : ''}`
    : status.state === 'error' ? 'Sincronización con error'
    : status.pending ? `${status.pending} cambio${status.pending === 1 ? '' : 's'} por subir`
    : `Sincronizado ${ago(status.lastSync)}`;
  const icon = syncing ? <RefreshCw size={15} className="animate-spin"/>
    : status.state === 'offline' ? <CloudOff size={15}/>
    : status.state === 'error' ? <TriangleAlert size={15} className="text-amber-300"/>
    : <Cloud size={15}/>;
  return <ControlButton controlId="sidebar.sync" label="Sincronizar ahora con Supabase (Ctrl+Alt+S)" className="nav-action w-full" icon={icon} onClick={() => { if (!syncing) void run(); }}>
    <span className="truncate text-xs text-neutral-400" title={status.lastError ?? undefined}>{label}</span>
  </ControlButton>;
}

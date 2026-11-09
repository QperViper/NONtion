import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Calculator, Clock, Globe, Play, Search, ShieldCheck, X } from 'lucide-react';
import { request } from '../lib/api';
import { ENGINES, asUrl, remember, youtubeId } from '../lib/internet';
import { formatNumber, quickMath } from '../lib/quickMath';

interface Result { title: string; url: string; snippet: string; }
interface Answer {
  query: string; failed: string[]; articles: Result[]; related: Result[];
  summary: { title: string; description: string; extract: string; url: string; image: string | null } | null;
  instant: { heading: string; text: string; url: string | null; source: string | null } | null;
}

const RECENT_KEY = 'nontion-internet-recent';
const readRecent = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 8) : []; } catch { return []; } };
const saveRecent = (list: string[]) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* solo comodidad */ } };
/**
 * Abre la página en una pestaña nueva de tu navegador (Brave, con Shields bloqueando anuncios), al frente.
 * «noopener»: la página abierta no puede tocar la ventana de nontion (protección contra «reverse tabnabbing»).
 */
function openTab(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export default function Internet() {
  const [input, setInput] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [recent, setRecent] = useState(readRecent);
  const field = useRef<HTMLInputElement>(null);
  const latest = useRef(0);
  useEffect(() => { field.current?.focus(); }, []);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 2500); return () => clearTimeout(t); }, [notice]);

  const math = quickMath(input);
  const typedUrl = asUrl(input);
  const typedVideo = youtubeId(input);

  const open = (url: string) => { openTab(url); setNotice('Abierto en una pestaña nueva de tu navegador'); };
  const search = async (raw: string) => {
    const query = raw.trim();
    if (!query) return;
    setError(null);
    const id = youtubeId(query);
    if (id) { setVideo(id); return; }
    const url = asUrl(query);
    if (url) { open(url); return; }
    if (quickMath(query) !== null) return;
    const list = remember(recent, query); setRecent(list); saveRecent(list);
    const ticket = ++latest.current;
    setLoading(true);
    try {
      const data = await request<Answer>(`/internet/search?q=${encodeURIComponent(query)}`);
      if (ticket === latest.current) setAnswer(data);
    } catch (e) { if (ticket === latest.current) { setAnswer(null); setError((e as Error).message); } }
    finally { if (ticket === latest.current) setLoading(false); }
  };
  const Link = ({ item }: { item: Result }) => <li>
    <button className="net-result" onClick={() => open(item.url)}>
      <span className="net-result-title">{item.title}<ArrowUpRight size={13}/></span>
      <span className="net-result-snippet">{item.snippet}</span>
      <span className="net-result-host">{new URL(item.url).hostname.replace(/^www\./, '')}</span>
    </button>
  </li>;

  return <div className="internet-page">
    <header className="calendar-header">
      <h1>Internet</h1>
      <span className="net-shield" title="Las páginas se abren en tu navegador. En Brave, Shields bloquea anuncios y rastreadores."><ShieldCheck size={14}/> Se abre en tu navegador</span>
    </header>

    <form className="net-search" role="search" onSubmit={e => { e.preventDefault(); void search(input); }}>
      <Search size={18} className="net-search-icon" aria-hidden/>
      <input ref={field} type="search" aria-label="Buscar en internet" value={input} onChange={e => setInput(e.target.value)}
        placeholder="Busca algo, pega un enlace de YouTube o escribe un cálculo…" autoComplete="off" spellCheck={false}/>
      {input && <button type="button" className="icon-button" aria-label="Borrar" onClick={() => { setInput(''); setAnswer(null); setError(null); field.current?.focus(); }}><X size={15}/></button>}
      <button type="submit" className="soft-button event-primary">{typedVideo ? 'Ver video' : typedUrl ? 'Abrir' : 'Buscar'}</button>
    </form>

    <div className="net-engines" role="group" aria-label={`Buscar ${input.trim() ? `«${input.trim()}» ` : ''}en`}>
      {ENGINES.map(engine => <button key={engine.id} className="net-chip" onClick={() => open(engine.url(input.trim()))}>{engine.label}<ArrowUpRight size={12}/></button>)}
    </div>

    {notice && <p className="net-notice" role="status">{notice}</p>}
    {error && <p className="event-error" role="alert">{error}</p>}

    {math !== null && <section className="net-card net-math" aria-live="polite">
      <Calculator size={18}/><div><span className="net-math-expr">{input.trim()} =</span><strong>{formatNumber(math)}</strong></div>
    </section>}

    {video && <section className="net-card net-video">
      <div className="net-video-frame"><iframe src={`https://www.youtube-nocookie.com/embed/${video}?autoplay=1&rel=0`} title="Video de YouTube" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/></div>
      <div className="net-video-actions">
        <button className="quiet-button" onClick={() => open(`https://www.youtube.com/watch?v=${video}`)}>Abrir en YouTube <ArrowUpRight size={13}/></button>
        <button className="quiet-button" onClick={() => setVideo(null)}><X size={13}/> Cerrar video</button>
      </div>
    </section>}

    {loading && <div className="net-card net-loading" role="status">Buscando…</div>}

    {!loading && answer && <div className="net-results">
      <button className="net-chip net-web" onClick={() => open(ENGINES[0].url(answer.query))}><Search size={12}/> Resultados web de «{answer.query}» en {ENGINES[0].label}<ArrowUpRight size={12}/></button>
      {answer.summary && <section className="net-card net-summary">
        {answer.summary.image && <img src={answer.summary.image} alt="" loading="lazy"/>}
        <div>
          <h2>{answer.summary.title}</h2>
          {answer.summary.description && <p className="net-desc">{answer.summary.description}</p>}
          <p>{answer.summary.extract}</p>
          <button className="quiet-button" onClick={() => open(answer.summary!.url)}>Leer en Wikipedia <ArrowUpRight size={13}/></button>
        </div>
      </section>}
      {answer.instant && answer.instant.text !== answer.summary?.extract && <section className="net-card">
        <h3 className="net-heading">{answer.instant.heading}</h3>
        <p>{answer.instant.text}</p>
        {answer.instant.url && <button className="quiet-button" onClick={() => open(answer.instant!.url!)}>{answer.instant.source || 'Fuente'} <ArrowUpRight size={13}/></button>}
      </section>}
      {answer.articles.length > 0 && <section><h3 className="nav-heading">MÁS EN WIKIPEDIA</h3><ul className="net-list">{answer.articles.map(a => <Link key={a.url} item={a}/>)}</ul></section>}
      {answer.related.length > 0 && <section><h3 className="nav-heading">RELACIONADO</h3><ul className="net-list">{answer.related.map(a => <Link key={a.url} item={a}/>)}</ul></section>}
      {!answer.summary && !answer.instant && !answer.articles.length && !answer.related.length && <section className="net-card">
        <p>No hay respuestas rápidas para «{answer.query}».</p>
        <button className="quiet-button" onClick={() => open(ENGINES[0].url(answer.query))}>Buscar en {ENGINES[0].label} <ArrowUpRight size={13}/></button>
      </section>}
      {answer.failed.length > 0 && <p className="net-foot">Sin respuesta de {answer.failed.join(' y ')} en este momento.</p>}
    </div>}

    {!loading && !answer && !video && math === null && <section className="net-empty">
      {recent.length > 0 ? <>
        <h3 className="nav-heading">RECIENTES</h3>
        <div className="net-engines">{recent.map(q => <button key={q} className="net-chip" onClick={() => { setInput(q); void search(q); }}><Clock size={12}/>{q}</button>)}</div>
      </> : <p className="net-hint"><Globe size={16}/> Escribe una pregunta para ver un resumen al instante. Los enlaces se abren en una pestaña de tu navegador.</p>}
      <p className="net-hint"><Play size={14}/> Pega un enlace de YouTube para verlo aquí mismo.</p>
    </section>}
  </div>;
}

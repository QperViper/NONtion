import type { Block } from '@blocknote/core';
import { threadIds } from './hyperthreads.ts';

export type ResourceKind = 'document' | 'whiteboard';
export interface ResourceRef { kind: ResourceKind; id: string; }
/** loaded=false: solo hay metadatos; el contenido se descarga al abrir el recurso. */
export interface Document {
  id: string; title: string; icon: string | null; coverImage: string | null;
  content: Block[]; isFavorite: boolean; version: number; deletedAt: string | null; parentId: string | null;
  loaded: boolean; threadLinks: string[];
}
export interface Whiteboard { id: string; title: string; snapshot: Record<string,unknown>; version: number; deletedAt: string | null; loaded: boolean; }
export interface Hiperhilo {
  id: string; sourceDocId: string | null; sourceBlockId: string | null; sourceText: string;
  destinationTitle: string; destinationPath: string; destinationType: ResourceKind | null; destinationId: string | null;
}
export interface ControlStyle {
  emoji?: string; image?: string | null; color?: string; background?: string; size?: number;
  radius?: number; hidden?: boolean; zone?: 'sidebar' | 'toolbar'; order?: number;
}
export interface Settings {
  backgroundEffect: 'vignette-bloom' | null;
  themeColor: string; bgImage: string | null; bgBlur: number; bgBloom: number; sidebarWidth: number;
  settingsWidth: number; isSidebarOpen: boolean; avatarImage: string | null; menuIconImage: string | null;
  customizations: Record<string,ControlStyle>;
}
export type Row = Record<string,unknown>;

/** Preferencias de pantalla: cada equipo guarda las suyas (no se sincronizan). */
export type DevicePrefs = Pick<Settings,'sidebarWidth'|'settingsWidth'|'isSidebarOpen'>;
export type SharedSettings = Omit<Settings,keyof DevicePrefs>;

export const linksOf = (content: Block[]) => [...threadIds(content)];

export function documentRow(d: Row): Document {
  const loaded = 'content' in d;
  const content = (loaded ? d.content || [] : []) as Block[];
  return {id:String(d.id),title:String(d.title),icon:d.icon as string|null,coverImage:d.cover_image as string|null,content,isFavorite:Boolean(d.is_favorite),
    version:Number(d.version),deletedAt:d.deleted_at as string|null,parentId:d.parent_id as string|null,loaded,
    threadLinks:loaded ? linksOf(content) : ((d.thread_links || []) as string[]).map(href => href.slice('/hilo/'.length))};
}
export function boardRow(d: Row): Whiteboard {
  const loaded = 'snapshot' in d;
  return {id:String(d.id),title:String(d.name),snapshot:(loaded ? d.snapshot || {} : {}) as Row,version:Number(d.version),deletedAt:d.deleted_at as string|null,loaded};
}
export function connectionRow(c: Row): Hiperhilo {
  return {id:String(c.id),sourceDocId:c.source_doc_id as string|null,sourceBlockId:c.source_block_id as string|null,sourceText:String(c.source_text),destinationTitle:String(c.destination_title),destinationPath:String(c.destination_path),destinationType:c.destination_type as ResourceKind|null,destinationId:c.destination_id as string|null};
}
export function sharedSettings(s: Row): SharedSettings {
  return {backgroundEffect:s.background_effect === 'vignette-bloom' ? 'vignette-bloom' : null,themeColor:String(s.theme_color),bgImage:s.bg_image as string|null,bgBlur:Number(s.bg_blur),bgBloom:Number(s.bg_bloom),avatarImage:s.avatar_image as string|null,menuIconImage:s.menu_icon_image as string|null,customizations:(s.customizations || {}) as Settings['customizations']};
}
/** Valores de la base para un equipo que todavía no tiene preferencias propias. */
export function serverDevicePrefs(s: Row): DevicePrefs {
  return {sidebarWidth:Number(s.sidebar_width),settingsWidth:Number(s.settings_width),isSidebarOpen:Boolean(s.is_sidebar_open)};
}

/** Combina una fila del servidor con lo que ya hay en memoria sin perder contenido ya descargado. */
export function mergeDocument(current: Document | undefined, incoming: Document): Document {
  if (!current || incoming.loaded) return incoming;
  return {...incoming,content:current.content,loaded:current.loaded,threadLinks:current.loaded || current.content.length ? current.threadLinks : incoming.threadLinks};
}
export function mergeBoard(current: Whiteboard | undefined, incoming: Whiteboard): Whiteboard {
  if (!current || incoming.loaded) return incoming;
  return {...incoming,snapshot:current.snapshot,loaded:current.loaded};
}
export function patchDocument(doc: Document, patch: Row): Document {
  const next = {...doc,...patch} as Document;
  if ('content' in patch) next.threadLinks = linksOf(next.content);
  return next;
}

const DEVICE_KEY = 'nontion-device';
export function readDevicePrefs(storage: Pick<Storage,'getItem'> | undefined = globalThis.localStorage): Partial<DevicePrefs> {
  try {
    const raw = JSON.parse(storage?.getItem(DEVICE_KEY) || '{}') as Row;
    const out: Partial<DevicePrefs> = {};
    if (Number.isInteger(raw.sidebarWidth)) out.sidebarWidth = Math.max(180,Math.min(600,Number(raw.sidebarWidth)));
    if (Number.isInteger(raw.settingsWidth)) out.settingsWidth = Math.max(300,Math.min(700,Number(raw.settingsWidth)));
    if (typeof raw.isSidebarOpen === 'boolean') out.isSidebarOpen = raw.isSidebarOpen;
    return out;
  } catch { return {}; }
}
export function writeDevicePrefs(patch: Partial<DevicePrefs>, storage: Pick<Storage,'getItem'|'setItem'> | undefined = globalThis.localStorage) {
  try { storage?.setItem(DEVICE_KEY,JSON.stringify({...readDevicePrefs(storage),...patch})); } catch { /* solo afecta a la comodidad de este equipo */ }
}

/** Calendario. Fechas como ISO con zona; en eventos de todo el día, end es exclusivo (día siguiente al último). */
export type Priority = 'baja' | 'media' | 'alta' | 'urgente';
export const PRIORITIES: { id: Priority; label: string }[] = [
  { id: 'baja', label: 'Baja' }, { id: 'media', label: 'Media' }, { id: 'alta', label: 'Alta' }, { id: 'urgente', label: 'Urgente' },
];
export interface CalendarEvent {
  id: string; title: string; description: string; emoji: string | null; color: string; priority: Priority;
  allDay: boolean; startAt: string; endAt: string; completed: boolean; documentId: string | null;
  version: number; deletedAt: string | null;
}
export type EventInput = Omit<CalendarEvent, 'id' | 'version' | 'deletedAt'>;
const iso = (value: unknown) => new Date(value as string).toISOString();
export function eventRow(e: Row): CalendarEvent {
  return {id:String(e.id),title:String(e.title),description:String(e.description ?? ''),emoji:(e.emoji as string | null) ?? null,color:String(e.color),
    priority:e.priority as Priority,allDay:Boolean(e.all_day),startAt:iso(e.start_at),endAt:iso(e.end_at),completed:Boolean(e.completed),
    documentId:(e.document_id as string | null) ?? null,version:Number(e.version),deletedAt:e.deleted_at ? iso(e.deleted_at) : null};
}

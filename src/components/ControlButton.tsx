import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useAppStore } from '../store/useAppStore';
import ImageAsset from './ImageAsset';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> { controlId: string; label: string; icon?: ReactNode; }
export default function ControlButton({controlId,label,icon,children,onClick,className='',style,...props}: Props) {
  const config = useAppStore(s => s.customizations[controlId]);
  const customizing = useAppStore(s => s.isCustomizing);
  const setEditing = useAppStore(s => s.setEditingControl);
  if (config?.hidden && !customizing) return null;
  return <button {...props} disabled={props.disabled && !customizing} type={props.type || 'button'} aria-label={label} title={customizing ? `Personalizar: ${label}` : props.title || label}
    data-control={controlId} className={`control-button ${customizing ? 'customizable' : ''} ${config?.hidden ? 'opacity-40' : ''} ${className}`}
    style={{...style,color:config?.color,backgroundColor:config?.background,borderRadius:config?.radius}}
    onClick={event => { if (customizing) { event.preventDefault(); setEditing(controlId); } else onClick?.(event); }}
    onContextMenu={event => { if (props.onContextMenu) props.onContextMenu(event); else { event.preventDefault(); setEditing(controlId); } }}>
    {config?.image ? <ImageAsset src={config.image} className="control-image" style={{width:config.size || 20,height:config.size || 20}} />
      : config?.emoji ? <span aria-hidden style={{fontSize:config.size || 20,lineHeight:1}}>{config.emoji}</span> : icon && <span className="control-glyph" style={config?.size?{width:config.size,height:config.size}:undefined}>{icon}</span>}
    {children}
  </button>;
}

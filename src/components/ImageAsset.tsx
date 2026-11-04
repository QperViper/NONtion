import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useAppStore } from '../store/useAppStore';
import { assetUrl } from '../lib/api';

// Draw the loaded frame once when reduced animation is enabled. No data extraction
// is needed, so externally hosted images can also be displayed on this canvas.
export default function ImageAsset({src,alt='',className='',style}:{src:string;alt?:string;className?:string;style?:CSSProperties}) {
  const pause=useAppStore(s=>s.pauseAnimations);
  const canvas=useRef<HTMLCanvasElement>(null);
  const [loadedSource,setLoadedSource]=useState('');
  useEffect(()=>{
    if(!pause)return;
    const image=new Image();let active=true;
    image.onload=()=>{
      if(!active||!canvas.current)return;
      const scale=Math.min(1,2048/Math.max(image.naturalWidth,image.naturalHeight));
      canvas.current.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.current.height=Math.max(1,Math.round(image.naturalHeight*scale));
      canvas.current.getContext('2d')?.drawImage(image,0,0,canvas.current.width,canvas.current.height);setLoadedSource(src);
    };
    image.src=assetUrl(src)!;
    return()=>{active=false;image.onload=null;image.src='';};
  },[src,pause]);
  if(!pause)return <img src={assetUrl(src)} alt={alt} className={className} style={style}/>;
  return <canvas ref={canvas} role="img" aria-label={alt||undefined} aria-hidden={!alt||undefined} className={className} style={{...style,...(loadedSource!==src?{opacity:0}: {})}}/>;
}

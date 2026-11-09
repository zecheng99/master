import {useEffect,useState} from 'react';
import {loadPhoto} from './cloud';
export function Photo({id,alt}:{id:string;alt:string;loading?:'lazy'|'eager'}){
 const [url,setUrl]=useState('');const [error,setError]=useState(false);const [attempt,setAttempt]=useState(0);
 useEffect(()=>{let cancelled=false;let object='';setError(false);setUrl('');loadPhoto(id).then(blob=>{if(cancelled)return;object=URL.createObjectURL(blob);setUrl(object);}).catch(()=>{if(!cancelled)setError(true);});return()=>{cancelled=true;if(object)URL.revokeObjectURL(object);};},[id,attempt]);
 return url?<img src={url} alt={alt}/>:error?<span role="button" tabIndex={0} className="photo-placeholder" onClick={e=>{e.stopPropagation();setAttempt(n=>n+1);}} onKeyDown={e=>{if(e.key==='Enter'){e.stopPropagation();setAttempt(n=>n+1);}}}>照片加载失败<br/>点此重试</span>:<span className="photo-placeholder" role="status">照片加载中…</span>;
}

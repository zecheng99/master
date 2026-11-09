import {useEffect,useRef} from 'react';
import '../../shared/cloud-sync-ui.js';
import type {SyncConfig,SyncPanel} from '../../shared/cloud-sync-ui.js';
export function SyncSettings({getConfig,onSave,busy}:{getConfig:()=>SyncConfig;onSave:(config:SyncConfig)=>Promise<void>;busy:boolean}){
 const host=useRef<HTMLDivElement>(null),panel=useRef<SyncPanel|null>(null),save=useRef(onSave);save.current=onSave;
 useEffect(()=>{panel.current=CloudSyncUI.mount(host.current!,{getConfig,onSave:config=>save.current(config)});return()=>{panel.current?.destroy();panel.current=null;};},[]);
 useEffect(()=>panel.current?.setBusy(busy),[busy]);
 return <div ref={host}/>;
}

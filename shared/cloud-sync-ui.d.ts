export type SyncConfig = {url:string;key:string};
export type SyncPanel = {element:HTMLElement;open():void;close():void;setStatus(text:string,error?:boolean):void;setBusy(value:boolean):void;refresh():void;destroy():void};
export type SyncPanelOptions = {dialog?:boolean;id?:string;ids?:Record<string,string>;description?:string;note?:string;getConfig():SyncConfig;onSave(config:SyncConfig):Promise<void>|void;onClose?():void;onDisconnect?():Promise<void>|void;backup?:{format:string;accept:string;description?:string;export():void;import(event:Event):void}};
declare global {var CloudSyncUI:{mount(host:HTMLElement,options:SyncPanelOptions):SyncPanel;validate(config:SyncConfig):SyncConfig;cloudIcon:string};}

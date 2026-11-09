/* Per-entry merge with persistent deletion tombstones. Foods preserve their ordered list. */
(function(root) {
  function merge(a,b) {
    const out={...a};
    for(const [key,entry] of Object.entries(b)) {
      const old=out[key];
      if(!old || entry.stamp>old.stamp || (entry.stamp===old.stamp && !entry.stamp.endsWith('-seed') && JSON.stringify(entry)>JSON.stringify(old))) out[key]=entry;
    }
    return out;
  }
  function flatten(records,fastRecords,foods,target,fastModeIndex) {
    const out={foods,target,fastModeIndex};
    for(const [day,record] of Object.entries(records)) for(const entry of record.entries||[]) out['protein:'+day+':'+entry.id]=entry;
    for(const [day,record] of Object.entries(fastRecords)) for(const field of ['start','end']) if(record[field]) out['fast:'+day+':'+field]=record[field];
    return out;
  }
  function materialize(entries) {
    const records={},fastRecords={};
    for(const [key,entry] of Object.entries(entries)) {
      if(entry.value===null) continue;
      const [kind,day,field]=key.split(':');
      if(kind==='protein') (records[day]??={entries:[]}).entries.push(entry.value);
      if(kind==='fast') (fastRecords[day]??={})[field]=entry.value;
    }
    for(const record of Object.values(records)) record.entries.sort((a,b)=>(a.timestamp||'').localeCompare(b.timestamp||'')||String(a.id).localeCompare(String(b.id)));
    return {records,fastRecords,foods:entries.foods?.value,target:entries.target?.value,fastModeIndex:entries.fastModeIndex?.value};
  }
  root.HealthSyncCore={merge,flatten,materialize};
})(globalThis);

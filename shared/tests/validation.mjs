import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({URL});
vm.runInContext(readFileSync(new URL('../cloud-sync-ui.js',import.meta.url),'utf8'),context);
const validate=context.CloudSyncUI.validate,key='test-key-with-at-least-24-characters';
test('shared URL validator accepts HTTPS and local development, trims only config',()=>{
 assert.equal(validate({url:' https://sync.example/ ',key:' '+key+' '}).url,'https://sync.example');
 assert.equal(validate({url:'http://127.0.0.1:8787',key}).url,'http://127.0.0.1:8787');
 assert.equal(validate({url:'https://sync.example',key}).key,key);
});
test('shared URL validator rejects insecure hosts, userinfo, paths, query credentials and short keys',()=>{
 for(const url of ['http://sync.example','https://name:password@sync.example','https://sync.example/path','https://sync.example?key=test','https://sync.example/#secret','javascript:alert(1)']) assert.throws(()=>validate({url,key}));
 assert.throws(()=>validate({url:'https://sync.example',key:'short'}));
});

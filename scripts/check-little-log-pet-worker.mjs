import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';

const root = resolve(process.argv[2] || 'data/little-log-pet-patch');
const handlers = {}, shown = []; let opened;
const self = {registration:{scope:'https://log.example/tracker/',showNotification:async (...args) => shown.push(args)},
  addEventListener:(name,fn) => {handlers[name] = fn;},clients:{matchAll:async () => [],openWindow:async url => {opened = url;}}};
vm.runInNewContext(readFileSync(resolve(root,'sw.js'),'utf8'),{self,URL,Set});
let work;
handlers.push({data:{json:() => ({kind:'littlepottchi',need:'leak',title:'Injected',body:'Private record',url:'https://evil.example'})},waitUntil:p => {work = p;}});
await work; assert.equal(shown[0][0],'Littlepottchi'); assert.match(shown[0][1].body,/needs a fresh diaper/);
assert.equal(shown[0][1].body.includes('Private'),false);
handlers.notificationclick({notification:{data:shown[0][1].data,close() {}},waitUntil:p => {work = p;}}); await work;
assert.equal(opened,'https://log.example/tracker/#games');
handlers.push({data:{json:() => ({kind:'littlepottchi',need:'__proto__'})},waitUntil:p => {work = p;}}); assert.equal(shown.length,1);
handlers.push({data:{json:() => ({kind:'littlepottchi',need:'mess',body:'Injected text'})},waitUntil:p => {work = p;}}); await work;
assert.equal(shown.length,2); assert.equal(shown[1][1].body,'Your Littlepottchi has a messy diaper and needs a fresh change.');
const {createGamesRoute} = await import(pathToFileURL(resolve(root,'server/games.mjs')));
const route = createGamesRoute('/tracker/',{LIDOLLBOT_PUBLIC_ORIGIN:'https://bot.example'});
for (const game of ['littlepottchi','clothes']) {
  let location; const response = {setHeader() {},writeHead:(status,headers) => {assert.equal(status,303); location = headers.Location;},end() {}};
  route({method:'GET'},response,`/tracker/games/${game}`); assert.equal(location,`https://bot.example/${game}/login`);
}
console.log('Pet push copy, safe notification navigation and both game redirects passed.');

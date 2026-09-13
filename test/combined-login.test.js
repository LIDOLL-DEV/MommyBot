import test from 'node:test';
import assert from 'node:assert/strict';
import {IdentityStore} from '../src/auth/store.js';
import {WalletService} from '../src/wallet/service.js';
import {createIdentityHandler} from '../src/auth/index.js';
const who={issuer:'https://auth.example',subject:'alice',username:'Alice',walletAccessToken:'proof'};
function fixture(t){
 let now=1000,exchanges=0;
 const identities=new IdentityStore(':memory:',()=>now),revoked=[];
 const client={config:{baseUrl:'https://wallet.example/api/',clientId:'lidollbot'},
  exchange:async()=>{exchanges++;return {access_token:'candidate',expires_in:3600,identity:who};},
  balance:async()=>({accountId:'alice-wallet',coins:5,stars:3}),revoke:async token=>revoked.push(token)};
 const wallet=new WalletService(':memory:',client,{now:()=>now});wallet.identityFor=id=>identities.get(id);
 t.after(async()=>{await wallet.close();identities.close();});
 function attempt(user='discord-alice',identity=who){const ticket=identities.begin(user,true),browser=identities.start(ticket,{verifier:'v',state:'s',nonce:'n'}),value=identities.take(browser),code=identities.verified(value,identity);return {value,code,user,validate:()=>identities.pendingConfirmation(user,code)};}
 async function stage(a,identity=who){await wallet.stageIdentity(a.value,identity,a.validate);}
 async function confirm(a){return wallet.confirmIdentity(a.user,a.validate(),activate=>identities.confirm(a.user,a.code,activate),a.validate);}
 return {identities,wallet,client,attempt,stage,confirm,revoked,exchanges:()=>exchanges,advance:ms=>{now+=ms;}};
} // Disposable databases and controlled time keep account-link tests independent of live services.
test('one confirmation activates matching identity and wallet, and same-account login renews access',async t=>{
 const f=fixture(t),a=f.attempt();await f.stage(a);assert.equal(f.identities.get(a.user),undefined);assert.equal(f.wallet.connection(a.user),undefined);
 assert.throws(()=>f.identities.pendingConfirmation('thief',a.code));await f.confirm(a);assert.equal(f.identities.get(a.user).subject,'alice');assert.equal((await f.wallet.balance(a.user)).stars,3);
 const renew=f.attempt();await f.stage(renew);await f.confirm(renew);assert.equal(f.exchanges(),2);
 f.identities.unlink(a.user);await assert.rejects(f.wallet.balance(a.user),/Finish.*login/);
});
test('wrong identity and accounts already linked to another Discord user cannot activate wallets',async t=>{
 const f=fixture(t),a=f.attempt();await f.stage(a);f.client.exchange=async()=>({access_token:'wrong',expires_in:3600,identity:{...who,subject:'bob'}});
 await assert.rejects(f.confirm(a),/did not match/);assert.equal(f.wallet.connection(a.user),undefined);assert.equal(f.identities.get(a.user),undefined);
 f.identities.confirm(a.user,a.code);assert.throws(()=>f.attempt(a.user,{...who,subject:'bob'}),/already linked/);
 const other=f.attempt('other-discord');await assert.rejects(f.stage(other),/another Discord/);assert.equal(f.wallet.connection(other.user),undefined);
});
test('stale callbacks cannot replace newer wallet proofs; expired proofs are removed',async t=>{
 const f=fixture(t),old=f.attempt(),current=f.attempt();await f.stage(current);await assert.rejects(f.stage(old),/Invalid or expired/);
 assert.equal(f.wallet.db.prepare('SELECT generation FROM combined_wallets').get().generation,current.value.generation);
 f.advance(600001);await assert.rejects(f.confirm(current),/Invalid or expired/);assert.equal(f.exchanges(),0);f.wallet.pruneProofs();assert.equal(f.wallet.db.prepare('SELECT proof FROM combined_wallets').get().proof,'');
});
test('lost balance response preserves candidate for retry; different pending wallet remains pinned',async t=>{
 const f=fixture(t),a=f.attempt();await f.stage(a);const balance=f.client.balance;f.client.balance=async()=>{throw Error('offline');};
 await assert.rejects(f.confirm(a),/offline/);assert.equal(f.identities.get(a.user),undefined);assert.equal(f.wallet.connection(a.user),undefined);
 f.client.balance=balance;f.wallet.db.prepare('INSERT INTO online_wallets VALUES (?,?,?,?,?,?)').run(a.user,'old',999999,'different-wallet',f.client.config.baseUrl,f.client.config.clientId);f.wallet.hasPending=()=>true;
 await assert.rejects(f.confirm(a),/previous account/);assert.deepEqual(f.revoked,[]);assert.equal(f.wallet.connection(a.user).token,'old');
 f.wallet.hasPending=()=>false;await f.confirm(a);assert.equal(f.exchanges(),1);assert.deepEqual(f.revoked,['old']);assert.equal(f.wallet.db.prepare('SELECT COUNT(*) n FROM combined_wallets').get().n,0);
});
test('login and wallet connect share one flow; login cannot supersede an active wallet confirmation',async t=>{
 const f=fixture(t),handler=createIdentityHandler(f.identities,{origin:'https://bot.example'},f.wallet);let reply;
 const interaction=group=>({user:{id:'discord-alice'},commandName:'lidollid',isChatInputCommand:()=>true,options:{getSubcommandGroup:()=>group,getSubcommand:()=>group?'connect':'login'},deferReply:async()=>{},editReply:async value=>{reply=value.content;}});
 await handler(interaction(null));assert.match(reply,/account and wallet/);await handler(interaction('wallet'));assert.match(reply,/account and wallet/);
 const a=f.attempt();await f.stage(a);let release;f.client.balance=()=>new Promise(r=>{release=r;});const confirming=f.confirm(a);await new Promise(r=>setImmediate(r));await handler(interaction(null));assert.match(reply,/Another wallet action/);release({accountId:'alice-wallet',stars:0,coins:0});await confirming;assert.equal(f.identities.get(a.user).subject,'alice');
});

test('failed wallet activation rolls back identity and retains the grant for recovery',async t=>{
 const f=fixture(t),a=f.attempt();await f.stage(a);
 f.wallet.db.exec("CREATE TRIGGER fail_wallet BEFORE INSERT ON online_wallets BEGIN SELECT RAISE(ABORT, 'synthetic storage failure'); END");
 await assert.rejects(f.confirm(a),/synthetic storage failure/);assert.equal(f.identities.get(a.user),undefined);assert.equal(f.wallet.connection(a.user),undefined);
 assert.equal(f.wallet.db.prepare('SELECT candidate FROM combined_wallets').get().candidate,'candidate');
 f.wallet.db.exec('DROP TRIGGER fail_wallet');await f.confirm(a);assert.equal(f.exchanges(),1);assert.equal(f.identities.get(a.user).subject,'alice');
});

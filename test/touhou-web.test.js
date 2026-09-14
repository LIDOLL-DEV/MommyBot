import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WalletService } from "../src/wallet/service.js";
import { WalletError } from "../src/wallet/client.js";
import { OnlineAdoptions } from "../src/wallet/adoptions.js";
import { TouhouStore, MOMIJI_OWNER_ID } from "../src/touhou/store.js";
import { createTouhouHandlers } from "../src/touhou/commands.js";
import { TouhouWebGame, publicGameAccess } from "../src/touhou/web-game.js";
import { loadCatalog } from "../src/touhou/catalog.js";
import { IdentityStore } from "../src/auth/store.js";
import { GameSessions } from "../src/games/sessions.js";
import { createTouhouWeb } from "../src/touhou/web.js";
import { createServer } from "node:http";

const alice="111111111111111111",bob="222222222222222222",guild="333333333333333333";
function fixture(t, {publicPlayers = false} = {}) {
  const identities = new IdentityStore(":memory:");
  const alice = publicPlayers ? identities.gameAccount({issuer:"https://auth.example",subject:"alice",username:"Alice"}).player_id : "111111111111111111";
  const bob = publicPlayers ? identities.gameAccount({issuer:"https://auth.example",subject:"bob",username:"Bob"}).player_id : "222222222222222222";
  const guild = publicPlayers ? "public" : "333333333333333333";
  t.after(()=>identities.close());
  const funds = { [alice]:{coins:1000,stars:5},[bob]:{coins:1000,stars:5} }, receipts=new Map();
  let lose=false, revoked=false;
  const wallet = new WalletService(":memory:", { config:{baseUrl:"https://wallet.example/",clientId:"lidollbot"},
    balance:async user=>({accountId:user,...funds[user]}),operation:async(user,input)=>{
      const key=`${user}:${input.request_id}`;if(receipts.has(key))return receipts.get(key);
      funds[user][input.asset]+=input.kind==="debit"?-input.amount:input.amount;
      const receipt={...input,currency:input.asset==="stars"?"Stars":"LiDollCoin",balance:funds[user][input.asset]};receipts.set(key,receipt);
      if(lose)throw new WalletError("lost","Response lost");return receipt;
    } });
  for(const user of [alice,bob])wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run(user,user,Date.now()+86400000,user,"https://wallet.example/","lidollbot");
  const store = new TouhouStore(":memory:", loadCatalog());
  const handlers = createTouhouHandlers(store,{wallet,adoptions:new OnlineAdoptions(store,wallet)});
  handlers.webState.economy.game.rng=()=>0.2; // Keep hit, enemy and escape rolls deterministic in this fixture.
  const access={list:async()=>[{id:guild,name:"Fixture server"}],require:async(id,user)=>{
    if(revoked||id!==guild||![alice,bob].includes(user))throw Error("Denied membership");
    return {id,name:"Fixture server",members:{fetch:async user=>{if(![alice,bob].includes(user))throw Error("Not a member");return{user:{id:user,bot:false}};}}};
  }};
  const game=new TouhouWebGame(handlers.webState,publicPlayers ? publicGameAccess(identities,{list:async()=>{throw Error("No Discord lookup for web players");},require:async()=>{throw Error("Denied membership");}}) : access);
  t.after(async()=>{await wallet.close();store.close();});
  const ui = user => {
    const session={user_id:user,token:randomUUID()}; let state;
    return { session,get state(){return state;},async open(){state=await game.state(session,guild);return state;},
      control(action){return state.panel.rows.flat().find(item=>item.custom_id.endsWith(`:${action}`));},
      async click(action,value){const control=this.control(action);assert.ok(control,action);state=await game.act(session,{guild,control:control.custom_id,...(value===undefined?{}:{value})});return state;},
      async input(input){state=await game.act(session,{guild,...input});return state;} };
  };
  return {game,store,wallet,funds,ui,identities,alice,bob,guild,lose:value=>{lose=value;},revoke:()=>{revoked=true;}};
}

test("web trader validates guild membership and displayed controls, and shares online adoption and battle rules", async t=>{
  const f=fixture(t),a=f.ui(alice);await a.open();
  assert.equal(f.store.collection(guild,alice).length,0);
  const old=a.control("adopt-stars").custom_id;await a.click("adopt-stars");
  assert.equal(f.funds[alice].stars,4);assert.equal(f.store.collection(guild,alice).length,1);
  await assert.rejects(a.input({control:old}),/menu changed/);
  const b=f.ui(bob);await b.open();await assert.rejects(b.input({control:a.control("party").custom_id}),/menu changed/);
  await a.click("party");await a.click("pick","0");assert.ok(a.state.panel.images[0].startsWith("/touhou/art/"));
  assert.doesNotMatch(JSON.stringify(a.state), /C:\\|account_id|token/);
  await a.click("rarity");await a.click("difficulty","Common");assert.ok(a.control("attack0"));
  await a.click("attack0");const battle=f.game.game.current(guild,alice);assert.equal(battle.turn,1);
  await a.click("home");await a.click("battle");await a.click("run");
  assert.equal(f.game.game.get(guild,alice,battle.id).outcome,"ran");
  assert.equal(f.store.character(guild,"Momiji Inubashiri").owner_id,MOMIJI_OWNER_ID);
  f.revoke();await assert.rejects(a.input({action:"restart-menu"}),/Denied membership/);
});

test("web listing forms, purchases, gifts and swap inbox use the same per-server ownership", async t=>{
  const f=fixture(t),a=f.ui(alice),b=f.ui(bob);await a.open();await b.open();
  await a.click("adopt-stars");await b.click("adopt-stars");
  await a.click("shop");await a.click("sell");await a.click("pick","0");await a.click("confirm");await a.click("price");
  assert.ok(a.state.panel.modal);await a.input({control:a.state.panel.modal.custom_id,value:"30"});
  await b.click("shop");await b.click("listings");await b.click("listing-pick","0");await b.click("confirm");
  assert.equal(f.funds[alice].coins,1030);assert.equal(f.funds[bob].coins,970);
  await a.input({action:"restart-menu"});await a.click("adopt-stars");await a.click("shop");await a.click("trade");await a.click("pick","0");await a.click("recipient",bob);await a.click("their-pick","0");await a.click("confirm");
  const state=await b.open();assert.equal(state.offers.length,1);
  await b.input({action:"offer",offer:state.offers[0].id,decision:"accept"});assert.equal(b.state.offers.length,0);
  await a.click("send");await a.click("pick","0");await a.click("recipient",bob);await a.click("confirm");
  assert.equal(f.store.collection(guild,alice).length,0);assert.equal(f.store.collection(guild,bob).length,3);
});

test("web recovery resumes a lost adoption without a second debit and honors paused wallet actions",async t=>{
  const f=fixture(t),a=f.ui(alice);await a.open();f.lose(true);await a.click("adopt-coins");
  assert.equal(f.funds[alice].coins,975);assert.ok(f.wallet.adoptions.pending(alice));
  f.lose(false);await a.click("retry-payment");assert.equal(f.funds[alice].coins,975);assert.equal(f.store.collection(guild,alice).length,1);
  await a.click("shop");await a.click("potions");await a.click("potion1");assert.equal(f.funds[alice].coins,955);
});

test("Refresh sees shared Discord changes and rejects a dropdown from before the refresh",async t=>{
  const f=fixture(t),a=f.ui(alice);await a.open();await a.click("adopt-stars");await a.click("party");
  const old=a.control("pick").custom_id;
  await f.game.adopt(guild,alice,"stars","discord-fixture-adoption");await a.open();
  assert.equal(a.control("pick").options.length,2);
  await assert.rejects(a.input({control:old,value:"0"}),/menu changed/);
});

test("web HTTP sessions enforce origin, CSRF, linked identity and logout without exposing credentials",async t=>{
  const f=fixture(t),identities=new IdentityStore(":memory:");
  identities.db.prepare("INSERT INTO identity_links VALUES (?,?,?,?,?)").run(alice,"https://auth.example","alice","Doll",Date.now());
  const sessions=new GameSessions(f.store.db,identities,{prefix:"touhou",command:"/lidollid login"});
  const token=sessions.openForIdentity({issuer:"https://auth.example",subject:"alice"});
  const config={origin:"http://127.0.0.1"},route=createTouhouWeb(config,f.game,sessions);
  const server=createServer(async(req,res)=>{if(!await route(req,res)){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));config.origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));identities.close();});
  const url=path=>`${config.origin}/touhou/${path}`,cookie=`touhou_session=${token}`;
  assert.equal((await fetch(url("api/state"))).status,401);
  const page=await fetch(url(""));assert.equal(page.status,200);assert.match(page.headers.get("content-security-policy"),/frame-ancestors 'none'/);
  const response=await fetch(url(`api/state?guild=${guild}`),{headers:{cookie}}),state=await response.json();
  assert.equal(response.status,200);assert.equal(state.balance.coins,1000);assert.doesNotMatch(JSON.stringify(state),/online_wallets|account_id|fixture-token/);
  const action={guild,control:state.panel.rows.flat().find(item=>item.custom_id.endsWith(":adopt-coins")).custom_id};
  const headers={cookie,Origin:config.origin,"Content-Type":"application/json","X-CSRF-Token":state.csrf};
  for(const invalid of [{...headers,Origin:"https://evil.example"},{...headers,"X-CSRF-Token":"no"},{...headers,"Content-Type":"text/plain"}])assert.equal((await fetch(url("api/action"),{method:"POST",headers:invalid,body:JSON.stringify(action)})).status,403);
  assert.equal(f.funds[alice].coins,1000);
  assert.equal((await fetch(url("api/action"),{method:"POST",headers,body:JSON.stringify(action)})).status,200);
  assert.equal(f.funds[alice].coins,975);
  assert.equal((await fetch(url("api/action"),{method:"POST",headers,body:JSON.stringify(action)})).status,400);
  assert.equal(f.funds[alice].coins,975);
  assert.equal((await fetch(url("api/logout"),{method:"POST",headers,body:"{}"})).status,200);
  assert.equal((await fetch(url("api/state"),{headers:{cookie}})).status,401);
  const next=sessions.openForIdentity({issuer:"https://auth.example",subject:"alice"});identities.unlink(alice);
  assert.equal((await fetch(url("api/state"),{headers:{cookie:`touhou_session=${next}`}})).status,401);
});


test("standalone LiD0llID players adopt, gift and swap in public without Discord or private-world access",async t=>{
  const f=fixture(t,{publicPlayers:true}),a=f.ui(f.alice),b=f.ui(f.bob);
  assert.deepEqual((await f.game.state(a.session)).guilds,[{id:"public",name:"Little Log community"}]);
  await assert.rejects(f.game.state(a.session,guild),/Little Log community/);
  await assert.rejects(f.game.state({user_id:"web_"+"0".repeat(32),token:"unknown"},"public"),/Sign in/);
  await a.open();
  const world=await f.game.guilds.require("public",f.alice);
  await assert.rejects(world.members.fetch(f.bob),/open.*community/);
  await b.open();assert.equal((await world.members.fetch(f.bob)).user.bot,false);
  await a.click("adopt-stars");await b.click("adopt-stars");
  assert.equal(f.funds[f.alice].stars,4);assert.equal(f.store.collection(guild,f.alice).length,0);
  await a.click("shop");await a.click("trade");await a.click("pick","0");
  await a.click("recipient","web_"+"f".repeat(32));assert.match(a.state.panel.text,/open.*community/);
  await a.click("recipient",f.bob);await a.click("their-pick","0");await a.click("confirm");
  await b.open();assert.equal(b.state.offers.length,1);
  await b.input({action:"offer",offer:b.state.offers[0].id,decision:"accept"});
  await a.click("send");await a.click("pick","0");await a.click("recipient",f.bob);await a.click("confirm");
  assert.equal(f.store.collection("public",f.alice).length,0);assert.equal(f.store.collection("public",f.bob).length,2);
  assert.equal(f.identities.db.prepare("SELECT COUNT(*) n FROM identity_links").get().n,0);
});

test("public access adds a world without granting linked players access to other Discord servers",async t=>{
  const identities=new IdentityStore(":memory:");t.after(()=>identities.close());
  identities.db.prepare("INSERT INTO identity_links VALUES (?,?,?,?,?)").run(alice,"https://auth.example","alice","Alice",1);
  const access=publicGameAccess(identities,{list:async()=>[{id:guild,name:"Members only"}],require:async(id,user)=>{assert.equal(user,alice);if(id!==guild)throw Error("Denied membership");return{id};}});
  assert.equal((await access.list(alice)).length,2);
  assert.equal((await access.require(guild,alice)).id,guild);
  await assert.rejects(access.require("999999999999999999",alice),/Denied membership/);
  assert.equal((await access.require("public",alice)).id,"public");
});

import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {IdentityStore} from "../src/auth/store.js";
import {GameSessions} from "../src/games/sessions.js";

const who={issuer:"https://auth.example",subject:"alice",username:"Alice"};
test("standalone progress survives restart, rename and later Discord linking without merging owners",()=>{
  const directory=mkdtempSync(join(tmpdir(),"public-game-accounts-"));let store;
  try {
    store=new IdentityStore(join(directory,"identities.db"));const first=store.gameAccount(who);
    assert.match(first.player_id,/^web_[a-f0-9]{32}$/);assert.equal(store.find(who.issuer,who.subject),undefined);
    store.close();store=new IdentityStore(join(directory,"identities.db"));
    const renamed=store.gameAccount({...who,username:"Renamed"});assert.equal(renamed.player_id,first.player_id);assert.equal(renamed.username,"Renamed");
    const other=store.gameAccount({...who,subject:"bob"});assert.notEqual(other.player_id,first.player_id);
    const issuer=store.gameAccount({...who,issuer:"https://different.example"});assert.notEqual(issuer.player_id,first.player_id);
    store.db.prepare("INSERT INTO identity_links VALUES (?,?,?,?,?)").run("111111111111111111",who.issuer,who.subject,who.username,Date.now());
    assert.equal(store.gameAccount(who).player_id,first.player_id,"Later Discord linking cannot strand web progress");
  }finally{store?.close();rmSync(directory,{recursive:true,force:true});}
});

test("existing Discord game progress retains its owner and unlink invalidates its sessions",()=>{
  const store=new IdentityStore(":memory:");
  try {
    const id="111111111111111111";
    store.db.prepare("INSERT INTO identity_links VALUES (?,?,?,?,?)").run(id,who.issuer,who.subject,who.username,1000);
    const sessions=new GameSessions(store.db,store,{prefix:"test",command:"/test"});
    const token=sessions.openForIdentity(who);assert.equal(sessions.get(token).user_id,id);
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM web_game_accounts").get().n,0);
    store.unlink(id);assert.equal(sessions.get(token),null);
    const fresh=sessions.openForIdentity(who);assert.match(sessions.get(fresh).user_id,/^web_/);
    assert.notEqual(sessions.get(fresh).user_id,id,"Unlink does not let a browser reclaim Discord-owned progress");
  }finally{store.close();}
});

test("web sessions stay isolated, expire, and cannot mint Discord handoff tickets",()=>{
  let now=1000;const store=new IdentityStore(":memory:",()=>now);
  try {
    const sessions=new GameSessions(store.db,store,{prefix:"test",command:"/test",now:()=>now});
    const alice=sessions.openForIdentity(who),bob=sessions.openForIdentity({...who,subject:"bob"});
    assert.notEqual(sessions.get(alice).user_id,sessions.get(bob).user_id);
    assert.notEqual(sessions.get(alice).csrf,sessions.get(bob).csrf);
    assert.throws(()=>sessions.begin(sessions.get(alice).user_id),/Link your account/);
    const again=sessions.openForIdentity(who);assert.equal(sessions.get(alice),null);assert.ok(sessions.get(bob));
    now+=8*3600000;assert.equal(sessions.get(again),null);assert.equal(sessions.get(bob),null);
    assert.throws(()=>store.gameAccount({username:"Alice"}),/verified/);
  }finally{store.close();}
});

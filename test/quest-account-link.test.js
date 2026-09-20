import test from "node:test";
import assert from "node:assert/strict";
import {WalletClient,walletConfig} from "../src/wallet/client.js";
import {WalletService} from "../src/wallet/service.js";
const BOT="a".repeat(64),GAME="b".repeat(64),config=walletConfig({LIDOLLCOIN_ENABLED:"true"});
const response=(body,status=200)=>new Response(JSON.stringify(body),{status});
const link={account_id:GAME,wallet_account_id:BOT,client_id:"lidollquest"};

test("bot requests its translated game owner with its existing wallet grant",async()=>{
 const client=new WalletClient(config,async(url,options)=>{
  assert.equal(url.pathname,"/tracker/api/lidollcoin/v1/quest-account");assert.equal(url.searchParams.get("client_id"),"lidollbot");
  assert.equal(url.searchParams.has("account_id"),false);assert.equal(options.method,"GET");assert.equal(options.headers.Authorization,"Bearer fixture-grant");return response(link);
 });
 const wallet=new WalletService(":memory:",client);
 try{
  wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run("alice","fixture-grant",Date.now()+60000,BOT,config.baseUrl,config.clientId);
  assert.equal(await wallet.questAccount("alice"),GAME);
  assert.equal(wallet.connection("alice").account_id,BOT,"Existing payment bindings are never rewritten.");
 }finally{await wallet.close();}
});

test("a revoked, missing or malformed bridge never becomes a game account",async()=>{
 for(const [body,status,code] of [[{},404,"quest_bridge_unavailable"],[{error:"invalid_token"},401,"invalid_token"],[{...link,account_id:"bad"},200,"invalid_response"],[{...link,client_id:"other"},200,"invalid_response"]]){
  const client=new WalletClient(config,async()=>response(body,status));await assert.rejects(client.questAccount("token"),error=>error.code===code);
 }
});

test("an account switch or mismatched translated wallet is rejected during the lookup",async()=>{
 for(const mode of ["switch","disconnect","mismatch"]){
  let wallet;
  const client=new WalletClient(config,async()=>{
   if(mode==="switch")wallet.db.prepare("UPDATE online_wallets SET token='replacement',account_id=? WHERE discord_id='alice'").run("c".repeat(64));
   if(mode==="disconnect")wallet.db.prepare("DELETE FROM online_wallets WHERE discord_id='alice'").run();
   return response(mode==="mismatch"?{...link,wallet_account_id:"c".repeat(64)}:link);
  });
  wallet=new WalletService(":memory:",client);
  try{
   wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run("alice","fixture-grant",Date.now()+60000,BOT,config.baseUrl,config.clientId);
   await assert.rejects(wallet.questAccount("alice"),error=>["account_changed","not_connected"].includes(error.code));
  }finally{await wallet.close();}
 }
});

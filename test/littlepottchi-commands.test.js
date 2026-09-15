import test from "node:test";
import assert from "node:assert/strict";
import { dressupFixture } from "../scripts/fixtures/dressup.mjs";
import { createPetCommands } from "../src/dressup/commands.js";
import { createGachaCommands } from "../src/gacha/index.js";
import { renderDollPng } from "../src/dressup/render.js";

const discordId="123456789012345678", config={origin:"https://bot.example"};
function fixture(t, render) {
  const f=dressupFixture(); t.after(()=>f.close());
  f.identities.db.prepare("INSERT INTO identity_links VALUES (?,?,?,?,?)").run(discordId,f.identity.issuer,f.identity.subject,"Doll",f.now);
  f.doll.snapshot(f.user);
  f.commands=createPetCommands(config,f.identities,f.doll,render);
  f.run=async (name,id=discordId) => {
    const sent={}, interaction={user:{id},commandName:name,isChatInputCommand:()=>true,
      deferReply:async options=>{sent.deferred=true;sent.options=options;},editReply:async reply=>{sent.reply=reply;}};
    sent.handled=await f.commands.handleInteraction(interaction); return sent;
  };
  return f;
} // Use real identity resolution and game stores while keeping every Discord message synthetic.

test("doll and stat slash commands register and both publicly share the invoking linked web player's saved state", async t=>{
  let rendered;
  const f=fixture(t,async snapshot=>{rendered=snapshot;return Buffer.from("PNG fixture");});
  const names=[];
  const gacha=createGachaCommands(config,f.sessions,f.diapers,f.commands);
  await gacha.registerGuild({id:"fixture",commands:{create:async command=>names.push(command.toJSON())}});
  for(const name of ["doll","pottchistats"]) assert.ok(names.some(row=>row.name===name&&row.description.includes("Publicly")));
  const p=f.doll.player(f.user); p.name="A saved doll"; f.doll.save(f.user,p);
  const share=await f.run("doll");
  assert.equal(share.deferred,true); assert.equal(share.options,undefined,"No ephemeral flags");
  assert.equal(share.reply.flags,undefined); assert.deepEqual(share.reply.allowedMentions,{parse:[]});
  assert.equal(share.reply.files[0].name,"littlepottchi.png"); assert.equal(rendered.player.name,"A saved doll");
  assert.equal(share.reply.embeds[0].toJSON().image.url,"attachment://littlepottchi.png");
  const stats=await f.run("pottchistats");
  assert.equal(stats.options,undefined); assert.equal(stats.reply.files,undefined);
  const embed=stats.reply.embeds[0].toJSON(); assert.equal(embed.title,"A saved doll");
  assert.deepEqual(share.reply.embeds[0].toJSON().fields.find(row=>row.name==="Diaper"),embed.fields.find(row=>row.name==="Diaper"),"PNG posts include the same diaper status as stat checks");
  assert.ok(embed.fields.some(field=>field.name==="Fullness"&&field.value==="85 / 100"));
  for(const sent of [share,stats]) {
    assert.ok(sent.reply.content.includes(`<@${discordId}>`));
    assert.ok(sent.reply.content.includes("https://bot.example/littlepottchi/"));
    assert.doesNotMatch(JSON.stringify(sent.reply),/nextWettingAt|nextMessAt|interval|reportId|issuer|subject|csrf|ticket=|gender|genitals|coins/i);
  }
  assert.equal(f.doll.db.prepare("SELECT 1 FROM littlepottchi_players WHERE user_id=?").get(discordId),undefined,"Do not create a second doll under the Discord ID");
});

test("prefix aliases are exact, public and routed through the existing gacha dispatcher",async t=>{
  const f=fixture(t,async()=>Buffer.from("PNG fixture")), commands=createGachaCommands(config,f.sessions,f.diapers,f.commands), replies=[];
  const message={content:" !DoLl ",author:{id:discordId,bot:false},reply:async reply=>replies.push(reply)};
  assert.equal(await commands.handleMessage(message),true); assert.equal(replies[0].files[0].name,"littlepottchi.png");
  message.content="!pottchistats"; assert.equal(await commands.handleMessage(message),true);
  assert.equal(replies[1].embeds[0].toJSON().description,"A public Littlepottchi check-in");
  assert.deepEqual(replies[1].allowedMentions,{parse:[],repliedUser:false});
  for(const text of ["!doll someone","!dolls","!pottchistats <@other>"]) {
    message.content=text; assert.equal(await commands.handleMessage(message),false);
  }
  message.content="!doll"; message.author.bot=true; assert.equal(await commands.handleMessage(message),false);
  assert.equal(replies.length,2);
  const edits=[];
  assert.equal(await commands.handleInteraction({user:{id:discordId},commandName:"pottchistats",isChatInputCommand:()=>true,deferReply:async()=>{},editReply:async body=>edits.push(body)}),true);
  assert.equal(edits.length,1);
});

test("unlinked users and missing dolls get public setup instructions without creating or exposing a save",async t=>{
  let renders=0; const f=fixture(t,async()=>{renders++;return Buffer.from("PNG fixture");});
  const unlinked=await f.run("doll","unknown"); assert.match(unlinked.reply.content,/lidollid login/); assert.equal(unlinked.reply.files,undefined);
  f.doll.db.prepare("DELETE FROM littlepottchi_players WHERE user_id=?").run(f.user);
  const missing=await f.run("pottchistats"); assert.match(missing.reply.content,/create your doll/);
  assert.ok(missing.reply.content.includes("https://bot.example/littlepottchi/"));
  assert.equal(f.doll.db.prepare("SELECT COUNT(*) AS n FROM littlepottchi_players").get().n,0); assert.equal(renders,0);
});

test("legacy Discord-first saves resolve correctly and arbitrary failures never disclose internal errors",async t=>{
  const f=fixture(t,async()=>{throw Error("PRIVATE_TOKEN PRIVATE_PATH");});
  f.identities.db.prepare("DELETE FROM web_game_accounts WHERE player_id=?").run(f.user);
  const p=f.doll.player(discordId); p.name="Discord-first doll"; f.doll.save(discordId,p);
  assert.equal((await f.run("pottchistats")).reply.embeds[0].toJSON().title,"Discord-first doll");
  const failed=await f.run("doll"); assert.match(failed.reply.content,/try again/i); assert.doesNotMatch(JSON.stringify(failed),/PRIVATE/);
});

test("pending renders are bounded per player and revoked account links cannot publish a finished PNG",async t=>{
  let finish; const f=fixture(t,()=>new Promise(resolve=>{finish=resolve;}));
  const first=f.run("doll"); await new Promise(resolve=>setImmediate(resolve));
  assert.match((await f.run("doll")).reply.content,/already being checked/);
  f.identities.unlink(discordId); finish(Buffer.from("PNG fixture"));
  const cancelled=await first; assert.equal(cancelled.reply.files,undefined); assert.match(cancelled.reply.content,/account link changed/);
});

test("public stats show actual cleanup and activities without accidental scheduling or tracker data",async t=>{
  const f=fixture(t,async()=>Buffer.from("PNG fixture")); f.doll.act(f.user,{action:"play"});
  const p=f.doll.player(f.user); p.care.leaking=true; p.care.needsWipe=true; f.doll.save(f.user,p);
  const stats=(await f.run("pottchistats")).reply.embeds[0].toJSON();
  assert.match(stats.fields.find(row=>row.name==="Diaper").value,/use 1 baby wipe/);
  assert.equal(stats.fields.find(row=>row.name==="Activity").value,"Playing");
  assert.doesNotMatch(JSON.stringify(stats),/countdown|next accident|hours|participant|report/i);
  const photo=(await f.run("doll")).reply.embeds[0].toJSON();
  assert.match(photo.fields[0].value,/Leaking.*use 1 baby wipe/);
  assert.match(photo.fields[0].value,/0 wet · 0 messy/);
});

test("real PNG exports preserve native size and change with saved wide stance and split hair",async t=>{
  const f=fixture(t), before=f.doll.snapshot(f.user);
  const narrow=await renderDollPng(before);
  f.seed(f.diapers,"ribbon-bouquet"); f.doll.act(f.user,{action:"change",design:"ribbon-bouquet"});
  const wide=f.doll.act(f.user,{...before.player,action:"appearance",hair:"TQ_Hair_4_Pink.png"});
  const png=await renderDollPng(wide);
  for(const buffer of [narrow,png]) {
    assert.equal(buffer.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
    assert.equal(buffer.readUInt32BE(16),387); assert.equal(buffer.readUInt32BE(20),875);
    assert.ok(buffer.length>10000); assert.ok(buffer.length<4*1024*1024);
  }
  assert.notDeepEqual(narrow,png); assert.equal(wide.base,"DQ_Base_2.png");
  assert.equal(f.coins,1000); assert.equal(f.receipts.size,0);
});

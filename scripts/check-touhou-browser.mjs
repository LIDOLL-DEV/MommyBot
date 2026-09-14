import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { IdentityStore } from "../src/auth/store.js";
import { GameSessions } from "../src/games/sessions.js";
import { WalletService } from "../src/wallet/service.js";
import { OnlineAdoptions } from "../src/wallet/adoptions.js";
import { TouhouStore } from "../src/touhou/store.js";
import { loadCatalog } from "../src/touhou/catalog.js";
import { createTouhouHandlers } from "../src/touhou/commands.js";
import { TouhouWebGame } from "../src/touhou/web-game.js";
import { createTouhouWeb } from "../src/touhou/web.js";

const puppeteer=(await import(pathToFileURL(process.env.PUPPETEER_MODULE).href)).default;
const user="111111111111111111",guild="333333333333333333",identities=new IdentityStore(":memory:"),store=new TouhouStore(":memory:",loadCatalog());
let coins=200,stars=5,browser,server;
const wallet=new WalletService(":memory:",{config:{baseUrl:"https://fixture.invalid/",clientId:"lidollbot"},balance:async()=>({accountId:user,coins,stars}),operation:async(_user,body)=>{
  if(body.asset==="stars")stars+=body.kind==="debit"?-body.amount:body.amount;else coins+=body.kind==="debit"?-body.amount:body.amount;
  return {...body,currency:body.asset==="stars"?"Stars":"LiDollCoin",balance:body.asset==="stars"?stars:coins};
}});
try{
  identities.db.prepare("INSERT INTO identity_links VALUES (?,?,?,?,?)").run(user,"https://auth.example","fixture","Doll",Date.now());
  wallet.db.prepare("INSERT INTO online_wallets VALUES (?,?,?,?,?,?)").run(user,user,Date.now()+3600000,user,"https://fixture.invalid/","lidollbot");
  const handlers=createTouhouHandlers(store,{wallet,adoptions:new OnlineAdoptions(store,wallet)});
  handlers.webState.economy.game.rng=()=>0.2; // Exercise a predictable battle and successful escape without changing production odds.
  const game=new TouhouWebGame(handlers.webState,{list:async()=>[{id:guild,name:"Cozy fixture server"}],require:async id=>{assert.equal(id,guild);return{id,name:"Cozy fixture server"};}});
  const sessions=new GameSessions(store.db,identities,{prefix:"touhou",command:"/lidollid login"}),config={origin:"http://127.0.0.1"};
  const route=createTouhouWeb(config,game,sessions);
  server=createServer(async(req,res)=>{if(!await route(req,res)){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));config.origin=`http://127.0.0.1:${server.address().port}`;
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH,headless:true,pipe:true});
  const page=await browser.newPage(),errors=[],violations=[];
  page.on("pageerror",error=>errors.push(error.message));page.on("console",message=>{if(/Content Security Policy|Refused to/i.test(message.text()))violations.push(message.text());});
  await page.setViewport({width:1360,height:1100});await page.goto(config.origin+"/touhou/");
  await page.waitForFunction(()=>document.getElementById("notice").textContent.includes("Sign in"));
  assert.equal(await page.$eval("#sign-in a",el=>el.getAttribute("href")),"/touhou/login");
  await browser.defaultBrowserContext().setCookie({name:"touhou_session",value:sessions.openForIdentity({issuer:"https://auth.example",subject:"fixture"}),url:config.origin,httpOnly:true,sameSite:"Lax"});
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll("#guild option").length===2);
  const idle=()=>page.waitForFunction(()=>!document.getElementById("refresh").disabled);
  const click=async text=>{await page.$$eval("#controls button",(buttons,text)=>{const button=buttons.find(button=>button.textContent.includes(text));if(!button)throw Error("Missing "+text+"; shown: "+buttons.map(button=>button.textContent).join(", ")+"; notice: "+document.getElementById("notice").textContent);button.click();},text);await idle();};
  await page.select("#guild",guild);await idle();await click("1 star");assert.equal(stars,4);
  await click("My party");await page.select("#controls select","0");await idle();
  assert.equal(await page.$eval("#portraits img",el=>el.complete&&el.naturalWidth>0),true);
  await click("Battle with");await page.select("#controls select","Common");await idle();
  await page.click("#controls button");await idle();assert.equal(game.game.current(guild,user).turn,1);
  if(process.env.TOUHOU_SCREENSHOT_DIR){await mkdir(process.env.TOUHOU_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.TOUHOU_SCREENSHOT_DIR,"touhou-desktop.png"),fullPage:true});}
  await page.setViewport({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.TOUHOU_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.TOUHOU_SCREENSHOT_DIR,"touhou-mobile.png"),fullPage:true});
  await click("Run");await click("Market & items");await click("Health potions");await click("Buy 1");assert.equal(coins,180);
  await click("Market & items");await click("List for sale");await page.select("#controls select","0");await idle();await click("Confirm");await click("Enter price");
  await page.waitForSelector("#price-dialog[open]");await page.type("#price","35");await page.click('#price-form button[type="submit"]');await idle();assert.equal(store.market(guild).find(item=>item.owner_id===user).price,35);
  await page.click("#logout");await page.waitForFunction(()=>document.getElementById("notice").textContent.includes("Sign in"));
  assert.deepEqual(errors,[]);assert.deepEqual(violations,[]);
  console.log("PASS: Touhou browser sign-in gate, server selection, adoption, artwork, battles, potions, listing dialog, mobile fit and logout. No real coins or Discord calls.");
}finally{await browser?.close();if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await wallet.close();store.close();identities.close();}

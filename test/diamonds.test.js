import test from 'node:test';
import assert from 'node:assert/strict';
import {WalletClient,walletConfig} from '../src/wallet/client.js';
import {balanceText} from '../src/wallet/commands.js';
test('diamond balances are validated and legacy wallet consent remains usable without inventing a zero balance',async()=>{
 let response={account_id:'account-a',balance:20,stars:3,stars_enabled:true};
 const client=new WalletClient(walletConfig({LIDOLLCOIN_ENABLED:'true'}),async()=>new Response(JSON.stringify(response),{status:200}));
 const legacy=await client.balance('token');assert.equal(legacy.diamonds,null);assert.equal(legacy.diamondsEnabled,false);assert.match(balanceText(legacy),/reconnect to enable/);
 response={...response,diamonds:7,diamonds_enabled:true};const balance=await client.balance('token');assert.equal(balance.diamonds,7);assert.equal(balance.diamondsEnabled,true);assert.match(balanceText(balance),/Diamonds: \*\*7\*\*/);
 for(const value of [-1,.5,'3',null,2147483648]){response.diamonds=value;await assert.rejects(client.balance('token'),/invalid diamond balance/);}
});
test('new approval requests ask for diamond consent and reject token grants that omit it',async()=>{
 let body;const client=new WalletClient(walletConfig({LIDOLLCOIN_ENABLED:'true'}),async(_url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({access_token:'a'.repeat(43),token_type:'Bearer',expires_in:3600,scope:'wallet:read wallet:write stars:read stars:write'}));});
 await assert.rejects(client.poll('device'),/required permissions/);
 await assert.rejects(client.exchange('proof'),/did not grant/);
 assert.equal(body.subject_token,'proof');
});

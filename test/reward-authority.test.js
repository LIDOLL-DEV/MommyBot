import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {WalletClient,walletConfig} from '../src/wallet/client.js';
const key='synthetic-server-only-reward-key-000000000000000',token='synthetic-recipient-token';
test('wallet credits/refunds sign the exact body and recipient; configuration does not serialize the key',async()=>{
 const config=walletConfig({LIDOLLCOIN_ENABLED:'true',LIDOLLCOIN_REWARD_KEY:key});assert.ok(!JSON.stringify(config).includes(key));
 const client=new WalletClient(config,async(url,options)=>{const body=JSON.parse(options.body);assert.equal(options.headers['X-Reward-Signature'],createHmac('sha256',key).update('lidollbot\n'+token+'\n'+JSON.stringify(body)).digest('hex'));assert.equal(options.redirect,'manual');return Response.json({ok:true});});
 await client.operation(token,{request_id:'credit',kind:'credit',asset:'diamonds',amount:2});await client.operation(token,{request_id:'refund',kind:'refund',original_id:'debit'});
});
test('missing reward configuration rejects before any credit/refund request is sent',async()=>{
 const client=new WalletClient(walletConfig({LIDOLLCOIN_ENABLED:'true'}),()=>assert.fail('Must not send an unsigned reward'));
 await assert.rejects(client.operation(token,{kind:'credit',amount:1,request_id:'x'}),e=>e.code==='reward_authorization');
 await assert.rejects(client.operation(token,{kind:'refund',original_id:'x',request_id:'r'}),e=>e.code==='reward_authorization');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {operationalView,renderOperationalBoardHtml} from '../src/operational-board.mjs';
test('stale supervisor cannot claim clean or Kilo are available',()=>{
  const view=operationalView({reportAgeMs:20000,report:{local:{rtc:true}}});
  assert.equal(view.up,false);
  assert.match(view.recovery,/Перезапуск/);
});
test('an open pipe does not prove an answer from ChatGPT',()=>{
  const view=operationalView({rtc:true,buildId:'new',protocolVersion:3,kiloVerification:{ok:true,buildId:'old',protocolVersion:2}});
  assert.match(view.kilo,/еще не проверен/);
});
test('TLS failure explains recovery without proposing to weaken trust',()=>{
  const view=operationalView({report:{local:{rtc:false,lastError:{text:'SELF_SIGNED_CERT_IN_CHAIN'}}}});
  assert.match(view.caption,/Проверка сертификата/);
  assert.match(view.recovery,/ошибки сертификата/);
});
test('recovery shows elapsed time and explicitly reports a missed 60 second target',()=>{
  assert.match(operationalView({rtc:false,recovery:{elapsedMs:23000,budgetMs:60000}}).recovery,/23 из 60 с/);
  assert.match(operationalView({rtc:false,recovery:{elapsedMs:61000,budgetMs:60000}}).recovery,/срок 60 с превышен/);
});
test('operations and resource counters use measured status data',()=>{
  const view=operationalView({rtc:true,egress:{txBytes:150,rxBytes:200,streams:2,queuedBytes:32},traffic:{recent:[{type:'read',ok:true},{type:'shell',ok:false}]},memoryBytes:1024,pendingCalls:3});
  assert.equal(view.txBytes,150);assert.equal(view.rxBytes,200);assert.equal(view.pending,3);
  assert.equal(view.recent[0].type,'shell');
  const html=renderOperationalBoardHtml();assert.match(html,/Последние операции/);assert.match(html,/polyline/);assert.match(html,/textContent/);
});

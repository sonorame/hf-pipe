import {createEgressMux} from '../../../src/egress-mux.mjs';
import {TYPE_STREAM_OPEN, TYPE_STREAM_DATA, TYPE_STREAM_CLOSE, dataPayload} from '../../../src/egress-stream.mjs';
import {createQosQueue} from '../../../src/egress-qos.mjs';
import {createRtcWorkerClient} from '../../../src/rtc-worker-client.mjs';
import {EventEmitter} from 'node:events';

const sent=[]; let id;
const mux=createEgressMux({hosts:['api.openai.com'],suffixes:[],send:async(t,i,p)=>{sent.push(t);if(t===TYPE_STREAM_OPEN)id=i;}});
const {stream}=await mux.openLocal('api.openai.com',443);
stream.destroy(); await new Promise(r=>setImmediate(r));
console.log('destroy sends CLOSE:',sent.includes(TYPE_STREAM_CLOSE));
for(let i=0;i<100;i++)await mux.onFrame(TYPE_STREAM_DATA,id,dataPayload(i,Buffer.alloc(65536)));
console.log('ACKs after local destroy:',sent.filter(t=>t===22).length);

const slow=createEgressMux({hosts:['api.openai.com'],suffixes:[],send:async(t,i)=>{if(t===TYPE_STREAM_OPEN)id=i;}});
const opened=await slow.openLocal('api.openai.com',443);
for(let i=0;i<100;i++)await slow.onFrame(TYPE_STREAM_DATA,id,dataPayload(i,Buffer.alloc(65536)));
console.log('unread stream buffered bytes:',opened.stream.readableLength,'highWaterMark:',opened.stream.readableHighWaterMark);
slow.closeAll(); mux.closeAll();

const q=createQosQueue();const results=[];let release;const gate=new Promise(r=>release=r);
q.pushStream(async()=>{await gate;});const first=q.flush().then(()=>results.push('first resolved'),()=>results.push('first rejected'));
q.pushStream(async()=>{throw Error('second job failed');});const second=q.flush().then(()=>results.push('second resolved'),()=>results.push('second rejected'));
release();await Promise.all([first,second]);console.log('QoS attribution:',results);

class Child extends EventEmitter{send(){} kill(){}}
const child=new Child();const client=createRtcWorkerClient({child});
child.emit('message',{kind:'status',up:false,snapshot:{dc:'open',connection:'disconnected'}});
console.log('worker says up=false, client says:',client.isRtcUp());
const p1=client.rtcCall({id:'same'},30).then(()=>console.log('p1 resolved'),()=>console.log('p1 timed out'));
const p2=client.rtcCall({id:'same'},70).then(()=>console.log('p2 resolved'),()=>console.log('p2 timed out'));
child.emit('message',{kind:'call-result',requestId:'same',result:{ok:true}});
await Promise.all([p1,p2]);client.close();

'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const Database=require('better-sqlite3'),{ensureSchema}=require('./push-routes.cjs'),{favoritePayload}=require('./push-personalization.cjs');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lb-followup-test-')),file=path.join(temp,'data.sqlite'),log=path.join(temp,'sent.jsonl');
const db=new Database(file);
db.exec(`CREATE TABLE push_subscriptions(id INTEGER PRIMARY KEY,user_id INTEGER,endpoint TEXT UNIQUE,p256dh TEXT,auth TEXT,settings_json TEXT);
CREATE TABLE user_prefs(user_id INTEGER,prefs_json TEXT);
CREATE TABLE push_traffic_state(id INTEGER PRIMARY KEY,status TEXT,confirmed_count INTEGER,episode_id TEXT,last_seen_at TEXT,last_sent_at TEXT,calm_since TEXT,notified_episode_id TEXT);
CREATE TABLE push_history(id INTEGER PRIMARY KEY,user_id INTEGER,train_number TEXT,event_type TEXT,event_key TEXT,sent_at TEXT);`);
ensureSchema(db);
const now=()=>new Date().toISOString(),past=n=>new Date(Date.now()-n*60000).toISOString();
db.prepare('INSERT INTO push_traffic_state VALUES(1,?,?,?,?,?,?,?)').run('severe',1,'old',now(),null,null,null);
for(let i=1;i<=3;i++) {
 db.prepare('INSERT INTO user_prefs VALUES(?,?)').run(i,JSON.stringify({trafficSevere:true,favoriteMorningTrain:i===1?'88704':'',favoriteFromStation:'Metz',favoriteToStation:'Luxembourg'}));
 db.prepare('INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?)').run(i,i,'https://example.test/'+i,'mock','mock',JSON.stringify({favorites:true,trafficSevere:i!==2}));
}
fs.writeFileSync(path.join(temp,'fake.cjs'),`const fs=require('fs'),w=require('web-push');w.setVapidDetails=()=>{};w.sendNotification=async(s,p,o)=>{if(process.env.FAIL_ENDPOINT===s.endpoint)throw Object.assign(Error('mock failure'),{statusCode:503});fs.appendFileSync(process.env.TEST_LOG,JSON.stringify({endpoint:s.endpoint,payload:JSON.parse(p),opts:o})+'\\n')};`);
const rt=path.join(temp,'rt.json'),siri=path.join(temp,'siri.json'),stat=path.join(temp,'static.json');
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v));
const data=trains=>write(rt,{generated_at:now(),trains});
const siriData=generated_at=>write(siri,{generated_at,situations:[]});siriData(now());
const run=(name='push_scan_traffic_severe.cjs',extra={})=>cp.execFileSync('/usr/bin/node',['-r',path.join(temp,'fake.cjs'),path.join(__dirname,name)],{cwd:__dirname,encoding:'utf8',env:{...process.env,DRY_RUN:'false',PUSH_DB_PATH:file,PUSH_RT_PATH:rt,PUSH_SIRI_PATH:siri,PUSH_STATIC_PATH:stat,TEST_LOG:log,VAPID_PUBLIC_KEY:'mock',VAPID_PRIVATE_KEY:'mock',...extra}});
const sent=()=>fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const endpointHash=id=>require("crypto").createHash("sha256").update("https://example.test/"+id).digest("hex");
const clear=()=>fs.writeFileSync(log,'');
data(Object.fromEntries([1,2,3,4].map(i=>[i,{status:'CANCELED',stops:{Metz:0,Luxembourg:0}}])));run();
assert.equal(sent().length,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM push_traffic_deliveries').get().n,2);
// A newly registered device must not receive the end of an incident it was not sent.
db.prepare('INSERT INTO push_subscriptions VALUES(4,1,?,?,?,?)').run('https://example.test/4','mock','mock',JSON.stringify({trafficSevere:true}));
const calm=()=>db.prepare("UPDATE push_traffic_state SET status='calming',calm_since=?,last_seen_at=?").run(past(21),now());
data({88704:{status:'ON_TIME',stops:{Metz:0,Luxembourg:0}}});calm();clear();run();
assert.deepEqual(sent().map(x=>x.endpoint).sort(),['https://example.test/1','https://example.test/3']);
assert(sent().every(x=>x.payload.body.includes('Des retards ou suppressions peuvent subsister')));
assert.equal(db.prepare('SELECT status FROM push_traffic_state').get().status,'calm');run();assert.equal(sent().length,2);
// Transport failure: already successful devices are not repeated, failed devices can retry.
for(const id of [1,3])db.prepare('INSERT INTO push_traffic_deliveries VALUES(?,?,?,?,NULL,?)').run(id,id,'episode',past(30),endpointHash(id));
calm();clear();run(undefined,{FAIL_ENDPOINT:'https://example.test/1'});assert.equal(sent().length,1);assert.equal(db.prepare('SELECT status FROM push_traffic_state').get().status,'calming');
run();assert.equal(sent().length,2);assert.equal(new Set(sent().map(x=>x.endpoint)).size,2);
// Stale official data or a scanner interruption must not announce recovery.
db.prepare('INSERT INTO push_traffic_deliveries VALUES(1,1,?,?,NULL,?)').run('episode',past(30),endpointHash(1));calm();clear();siriData(past(16));run();assert.equal(sent().length,0);assert.equal(db.prepare('SELECT status FROM push_traffic_state').get().status,'calming');
siriData(now());calm();db.prepare('UPDATE push_traffic_state SET last_seen_at=?').run(past(6));run();assert.equal(sent().length,0);
calm();const before=db.prepare('SELECT * FROM push_traffic_state').get();run(undefined,{DRY_RUN:'true'});assert.deepEqual(db.prepare('SELECT * FROM push_traffic_state').get(),before);assert.equal(sent().length,0);
// Favorite delay uses this user's actual segment, not the maximum elsewhere.
const prefs={from:'Metz',to:'Luxembourg'},win={origin:'Nancy',destination:'Luxembourg'},visible={from:'Metz',to:'Luxembourg'};
let p=favoritePayload('88704',{type:'delay',delay:40},{Nancy:40,Metz:12,Thionville:11,Luxembourg:8},prefs,win,visible);
assert(p.title.includes('+12 min'));assert(p.body.includes('Départ de Metz : +12 min'));assert(p.body.includes('Arrivée à Luxembourg : +8 min'));
assert.equal(favoritePayload('88704',{type:'delay',delay:40},{Nancy:40,Metz:3,Luxembourg:0},prefs,win,visible),null);
assert(favoritePayload('88704',{type:'cancel'},{Metz:0,Luxembourg:0},prefs,win,visible).body.includes('Ton trajet Metz → Luxembourg'));
assert(favoritePayload('88704',{type:'partial_cancel'},{Metz:0,Luxembourg:0},prefs,win,visible).title.includes('desserte modifiée'));
const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
write(stat,{trains:{88704:{origin:'Nancy',destination:'Luxembourg',departure:clock,arrival:clock}}});data({88704:{status:'DELAYED',stops:{Nancy:40,Metz:12,Thionville:11,Luxembourg:8}}});clear();run('push_scan_realtime.cjs');
assert.equal(sent().length,2);assert(sent().every(x=>x.payload.title==='⏱️ Ton favori 88704 : +12 min'));assert.equal(db.prepare('SELECT COUNT(*) n FROM push_history').get().n,1);run('push_scan_realtime.cjs');assert.equal(sent().length,2);
db.close();fs.rmSync(temp,{recursive:true,force:true});
console.log('PASS: suivi réservé aux destinataires initiaux, une reprise par appareil, reprise après échec, opt-out, données périmées/interruption, simulation sans écriture, messages personnels et anti-spam favoris.');

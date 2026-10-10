const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const source = fs.readFileSync(path.join(root,'assets/lb-index-features.js'),'utf8');
const start = source.indexOf('  function profileNextServiceNotice(');
const end = source.indexOf('  function renderHero(', start);
assert.ok(start > 0 && end > start, 'next train function found');
const rules = source.slice(start, end);
const observedNow = Date.parse('2026-10-10T20:12:00Z'); // samedi 22:12 Luxembourg

function notice({now=observedNow, payload=null, number='88501', serviceDate='2026-10-12', departure='06:20', phase='scheduled', canceled=false}={}){
  class MockDate extends Date {
    constructor(...args){super(...(args.length ? args : [now]));}
    static now(){ return now; }
    static UTC(...args){ return Date.UTC(...args); }
  }
  const win = { lbGetTrainStaticNextPayload: () => payload };
  const ctx = vm.createContext({
    Date:MockDate, Intl, Number, String, Math, window:win,
    todayIso:()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Luxembourg',year:'numeric',month:'2-digit',day:'2-digit'}).format(new MockDate()),
    formatDate:(s)=>s
  });
  vm.runInContext(rules,ctx);
  return ctx.profileNextServiceNotice(number,serviceDate,departure,phase,canceled);
}
function payload(serviceDate, departure_time, label=serviceDate){
  return {nextServiceDate:serviceDate,nextServiceLabel:label,train:{stop_times:[{departure_time}]}};
}

test('88501 lundi 12 octobre 06:20 now appears with a countdown Saturday night',()=>{
  const message=notice();
  assert.match(message,/TER 88501/);
  assert.match(message,/2026-10-12 à 06:20/);
  assert.match(message,/dans 1 j 8 h/);
});
test('evening 88532 still uses the GTFS calendar following a completed run',()=>{
  const message=notice({phase:'after',number:'88532',serviceDate:'2026-10-10',departure:'17:39',payload:payload('2026-10-12','17:39','lundi 12 octobre')});
  assert.match(message,/TER 88532/);
  assert.match(message,/lundi 12 octobre à 17:39/);
});
test('nearest GTFS service beats selected later dated trip, not a made-up next service',()=>{
  const message=notice({serviceDate:'2026-10-13',departure:'06:20',payload:payload('2026-10-12','06:20')});
  assert.match(message,/2026-10-12 à 06:20/);
});
test('cancelled occurrence is not presented as the next service',()=>{
  assert.equal(notice({serviceDate:'2026-10-12',phase:'scheduled',canceled:true,payload:payload('2026-10-12','06:20')}),'');
  assert.match(notice({serviceDate:'2026-10-12',phase:'scheduled',canceled:true,payload:payload('2026-10-13','06:20')}),/2026-10-13/);
});
test('past selected dates and missing calendar do not create invented departures',()=>{
  assert.equal(notice({phase:'scheduled',serviceDate:'2026-10-09'}),'');
  assert.equal(notice({phase:'after',serviceDate:'2026-10-10'}),'');
});
test('winter clock offset is respected for Luxembourg October 26',()=>{
  const winter=notice({now:Date.parse('2026-10-25T21:00:00Z'),serviceDate:'2026-10-26',departure:'06:20'});
  assert.match(winter,/dans 8 h 20/);
});
test('GTFS hours after midnight are supported for an overnight train',()=>{
  const afterMidnight=notice({serviceDate:'2026-10-11',departure:'25:20'});
  assert.match(afterMidnight,/25:20/);
  assert.match(afterMidnight,/dans 1 j 3 h/);
});
test('async calendar hydration covers scheduled favorites and avoids new endpoints',()=>{
  assert.match(source,/heroState\?\.journeyPhase === 'scheduled'/);
  assert.match(source,/profileNextServiceNotice\(number, dateIso, departure, journeyPhase, canceled\)/);
  assert.match(source,/requestId !== state\.requestId/);
  assert.match(source,/window\.lbLoadTrainStaticToday\(\)\.then/);
  const compact = fs.readFileSync(path.join(root,'assets/lb-my-journey-inline-v1.js'),'utf8');
  assert.match(compact,/lbmj-next-redundant/);
  assert.doesNotMatch('🐮 '+notice(),/^circulation pr[eé]vue le/i);
});

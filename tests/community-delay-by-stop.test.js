'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'vps/map-v2/lb-community-marker-delay-by-stop-v1.js'), 'utf8');
const features = fs.readFileSync(path.join(root, 'assets/lb-index-features.js'), 'utf8');

function makeContext(){
  const context = {
    console,
    setTimeout:()=>0,
    requestAnimationFrame:()=>1,
    window:{ addEventListener(){}, lbCommunityMapViewState(){ return {trains:{}}; } },
    document:{
      readyState:'complete',
      addEventListener(){},
      querySelectorAll(){ return []; },
      querySelector(){ return null; },
      getElementById(){ return null; }
    },
    stopTimesByTrip:new Map([['trip-1',[
      {stop_id:'NANCY'},
      {stop_id:'PAGNY'},
      {stop_id:'PAM'},
      {stop_id:'METZ'}
    ]]]),
    stopsById:new Map([
      ['NANCY',{name:'Nancy'}],
      ['PAGNY',{name:'Pagny-sur-Moselle'}],
      ['PAM',{name:'Pont-à-Mousson'}],
      ['METZ',{name:'Metz'}]
    ]),
    trainDataById:new Map()
  };
  context.window.window=context.window;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

test('delay starts exactly at the first reported station and changes only at the next report', () => {
  const context=makeContext();
  const item={travelerStops:{
    'pagny-sur-moselle':{station:'Pagny-sur-Moselle',delayMin:5,lastReportAt:100},
    'pont-a-mousson':{station:'Pont-à-Mousson',delayMin:8,lastReportAt:200}
  }};
  const fn=context.window.lbCommunityDelayByStopV1.reportForTrainPosition;

  assert.equal(fn({id:'trip-1',segmentIndex:0},item),null);
  assert.equal(fn({id:'trip-1',segmentIndex:1},item)?.delayMin,5);
  assert.equal(fn({id:'trip-1',segmentIndex:1,segmentProgress:.9},item)?.delayMin,5);
  assert.equal(fn({id:'trip-1',segmentIndex:2},item)?.delayMin,8);
  assert.equal(fn({id:'trip-1',segmentIndex:3},item)?.delayMin,8);
});

test('community snapshot no longer manufactures a median delay between stations', () => {
  assert.doesNotMatch(features, /values\.length % 2\s*\? values\[middle\]/);
  assert.match(features, /jamais de moyenne\/médiane entre deux gares/);
  assert.match(features, /const latest = reports\.slice\(\)\.sort/);
});

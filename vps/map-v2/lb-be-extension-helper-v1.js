/* Shared matching rules for Belgian international end-stations. Pure, side-effect free. */
(function(root){
  'use strict';
  if(root.lbVerifyInternationalBeEndpoint)return;
  function station(name){
    return String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
      .replace(/\((?:lu|be|belgium)\)/g,'').replace(/,\s*/g,' ')
      .replace(/\b(?:gare centrale|gare)\b/g,'')
      .replace(/^arlon\s+(?=sterpenich)/,'')
      .replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
  }
  function minutes(clock){
    const m=String(clock||'').match(/^(\d{1,3}):(\d{2})/);
    return m?Number(m[1])*60+Number(m[2]):null;
  }
  function sameTime(a,b){
    const x=minutes(a),y=minutes(b);
    if(x===null||y===null)return false;
    const d=Math.abs(x-y);
    return Math.min(d,Math.abs(d-1440))<=3;
  }
  function stamp(stop){
    return String(stop?.departure||stop?.arrival||stop?.time||'');
  }
  function find(info,stops,index){
    if(!Array.isArray(stops)||stops.length<2 ||index?.schema!=='lb-be-international-ends-v1')return null;
    const date=String(info?.date||''),number=String(info?.number||'');
    const wantedType=String(info?.type||'').toUpperCase();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)|| !/^\d{2,6}$/.test(number))return null;
    const candidates=index.trains?.[date+'|'+number]||[];
    const results=[];
    for(const be of candidates){
      if(be.date!==date||be.number!==number || !Array.isArray(be.anchors))continue;
      // Railway labels can differ across the border (RE/IC). Allow this only
      // when three or more independently timed common stops prove identity.
      const differingType=Boolean(wantedType&&wantedType!=='CFL'&&wantedType!=='TRAIN'
        &&wantedType!==String(be.type||'').toUpperCase());
      let previous=-1;
      const matches=[];
      for(let i=0;i<stops.length;i++){
        const name=station(stops[i]?.name||stops[i]?.stop_name);
        if(!name)continue;
        for(let j=previous+1;j<be.anchors.length;j++){
          if(name!==station(be.anchors[j]?.name)||!sameTime(stamp(stops[i]),be.anchors[j]?.time))continue;
          matches.push({i,j});
          previous=j;
          break;
        }
      }
      if(matches.length<(differingType?3:2))continue;
      const first=stops[0],last=stops[stops.length-1];
      const sameOrigin=station(first.name||first.stop_name)===station(be.origin?.name);
      const sameDest=station(last.name||last.stop_name)===station(be.destination?.name);
      const extendsOrigin=!sameOrigin && sameDest
        && matches[0].i===0 && matches[0].j>0
        && matches[matches.length-1].i===stops.length-1
        && matches[matches.length-1].j===be.anchors.length-1;
      const extendsDest=sameOrigin && !sameDest
        && matches[0].i===0 && matches[0].j===0
        && matches[matches.length-1].j<be.anchors.length-1;
      if(!extendsOrigin&&!extendsDest)continue;
      results.push({origin:extendsOrigin?be.origin:null,
                    destination:extendsDest?be.destination:null,
                    matches:matches.length,
                    date,number,
                    sectionFrom:first.name||first.stop_name,
                    sectionTo:last.name||last.stop_name});
    }
    // Ambiguous matching: never guess.
    return results.length===1?results[0]:null;
  }
  root.lbVerifyInternationalBeEndpoint=find;
})(typeof window==='undefined'?globalThis:window);

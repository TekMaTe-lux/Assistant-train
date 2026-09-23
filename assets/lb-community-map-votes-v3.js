'use strict';

/* Voix du Bétail -> carte V3 SAFE : complète le snapshot natif sans jamais l'écraser. */
(() => {
  if (window.__LB_COMMUNITY_MAP_VOTES_V3_SAFE__) return;
  window.__LB_COMMUNITY_MAP_VOTES_V3_SAFE__ = true;

  const MAP_SELECTOR = '#carte iframe';
  const SIGNAL_TTL_MS = 45 * 60 * 1000;
  const API_URLS = ['https://vps.labetaillere.fr/api/comments?scope=signals','/api/comments?scope=signals'];
  const signals = [];
  const boundFrames = new WeakSet();
  let refreshPromise = null, lastFetchAt = 0, timer = 0;

  const normalizeTrain = (value) => {
    const m = String(value || '').match(/\d{3,6}/g);
    return m?.length ? m[m.length - 1].replace(/^0+(?=\d)/,'') : '';
  };
  const normalizeStop = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/,?\s*gare(?:\s+centrale)?\b.*$/i,'')
    .replace(/\b(gare|centrale|station)\b/g,' ')
    .replace(/[’']/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();

  function parseTs(raw){
    const value = raw?.created_at ?? raw?.createdAt ?? raw?.ts ?? raw?.timestamp ?? raw?.date ?? '';
    if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value || '').trim())) {
      let n = Number(value); if (!Number.isFinite(n) || n <= 0) return 0; if (n < 1e12) n *= 1000; return n;
    }
    let text = String(value || '').trim();
    // SQLite CURRENT_TIMESTAMP est UTC mais sans suffixe Z.
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) text = text.replace(' ','T') + 'Z';
    const parsed = Date.parse(text); return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeSignal(raw){
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id ?? '').trim();
    const message = String(raw.message ?? raw.text ?? '').trim();
    const parsed = message.match(/^\s*\[(RETARD|DELAY|SUPPRESSION|INFORMATION|A L'HEURE|A-L'HEURE|A LHEURE)\]\s*(?:#?([A-Z]{2,8})\s*)?(\d{3,6})?\s*(?:\[([^\]]+)\])?/i);
    const trainNumber = normalizeTrain(raw.train_number ?? raw.trainNumber ?? raw.train ?? parsed?.[3] ?? message);
    const station = String(raw.station ?? raw.stop_name ?? raw.stopName ?? parsed?.[4] ?? '').trim();
    let signalType = String(raw.signal_type ?? raw.signalType ?? raw.type ?? parsed?.[1] ?? '').trim().toLowerCase();
    signalType = signalType.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\s_]+/g,'-');
    if (['delay','late','retard-train'].includes(signalType)) signalType = 'retard';
    const textDelay = Number(message.match(/\+\s*(\d{1,3})\s*min/i)?.[1] || 0);
    const delayMin = Math.round(Number(raw.delay_min ?? raw.delayMin ?? raw.delay ?? textDelay ?? 0) || 0);
    const upvotes = Math.max(0,Math.round(Number(raw.upvotes ?? 0)||0));
    const downvotes = Math.max(0,Math.round(Number(raw.downvotes ?? 0)||0));
    const myVote = Math.max(-1,Math.min(1,Math.round(Number(raw.my_vote ?? raw.myVote ?? 0)||0)));
    const ts = parseTs(raw);
    if (!id || !trainNumber || !station || signalType !== 'retard' || !(delayMin > 0)) return null;
    if (ts && ts < Date.now() - SIGNAL_TTL_MS) return null;
    if ((upvotes - downvotes) <= -3) return null;
    return { id, trainNumber, station, stopKey:normalizeStop(station), delayMin, upvotes, downvotes, myVote, ts };
  }

  const extractList = (data) => Array.isArray(data) ? data : ['comments','signals','items','data','results'].map(k=>data?.[k]).find(Array.isArray) || [];
  const canContribute = () => window.lbIsAuthed === true;
  const mapFrames = () => Array.from(document.querySelectorAll(MAP_SELECTOR));
  const voteMeta = (s) => s ? { signalId:s.id, score:s.upvotes-s.downvotes, upvotes:s.upvotes, downvotes:s.downvotes, myVote:s.myVote } : null;

  async function refreshSignals(force=false){
    if (refreshPromise) return refreshPromise;
    if (!force && lastFetchAt && Date.now()-lastFetchAt < 8000) return signals;
    refreshPromise = (async()=>{
      let lastError = null;
      for (const url of API_URLS) {
        try {
          const sep=url.includes('?')?'&':'?';
          const res=await fetch(`${url}${sep}_=${Date.now()}`,{credentials:'include',cache:'no-store'});
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const list=extractList(await res.json()).map(normalizeSignal).filter(Boolean);
          signals.splice(0,signals.length,...list); lastFetchAt=Date.now(); return signals;
        } catch(e){ lastError=e; }
      }
      console.warn('[Voix du Bétail / carte] signalements indisponibles',lastError?.message||lastError);
      return signals;
    })().finally(()=>{refreshPromise=null;});
    return refreshPromise;
  }

  function latestSignalsByStop(){
    const map = new Map();
    signals.slice().sort((a,b)=>Number(a.ts||0)-Number(b.ts||0) || Number(a.id||0)-Number(b.id||0)).forEach((s)=>{
      const key=`${s.trainNumber}|${s.stopKey}`;
      map.set(key,s); // la dernière mesure réellement publiée à cette gare fait foi
    });
    return Array.from(map.values());
  }

  function enrichedSnapshot(){
    let base=null;
    try { base=window.lbCommunityLive?.getMapSnapshot?.() || null; } catch(_) {}
    if (!base || typeof base !== 'object') return null; // ne jamais faire disparaître "À bord"
    const trains={};
    Object.entries(base.trains||{}).forEach(([number,raw])=>{
      const item=raw && typeof raw==='object' ? raw : {};
      trains[number]={...item,travelerStops:{...(item.travelerStops||{})}};
    });

    const first=latestSignalsByStop();
    first.forEach((s)=>{
      const previous=trains[s.trainNumber] && typeof trains[s.trainNumber]==='object' ? trains[s.trainNumber] : {};
      const travelerStops={...(previous.travelerStops||{})};
      const existing=travelerStops[s.stopKey];
      if (existing) travelerStops[s.stopKey]={...existing,vote:voteMeta(s)};
      else travelerStops[s.stopKey]={station:s.station,delayMin:s.delayMin,reports:1,lastReportAt:s.ts,vote:voteMeta(s)};
      trains[s.trainNumber]={...previous,travelerStops};
    });

    const byTrain=new Map();
    first.forEach(s=>{ if(!byTrain.has(s.trainNumber)) byTrain.set(s.trainNumber,[]); byTrain.get(s.trainNumber).push(s); });
    byTrain.forEach((list,number)=>{
      const item=trains[number]||{};
      if (Number(item.travelerDelayMin)>0) return; // snapshot natif prioritaire
      const latest=list.slice().sort((a,b)=>Number(b.ts||0)-Number(a.ts||0))[0] || null;
      if (!latest) return;
      // Compatibilité uniquement : reprendre une vraie mesure, jamais une moyenne/médiane.
      trains[number]={...item,travelerDelayMin:latest.delayMin,delayReports:list.length,lastReportAt:Number(latest.ts||0)};
    });
    return {...base,canContribute:canContribute(),trains,voteMetadata:true,voiceToMapSafe:true};
  }

  function postSnapshot(target=null){
    const snap=enrichedSnapshot(); if(!snap) return;
    const payload={type:'lb:community:snapshot',...snap};
    if(target){ try{target.postMessage(payload,'*');}catch(_){} return; }
    mapFrames().forEach(f=>{try{f.contentWindow?.postMessage(payload,'*');}catch(_){}});
  }
  async function refreshAndBroadcast(target=null,force=false){ await refreshSignals(force); postSnapshot(target); }
  function queue(delay=0,target=null,force=false){ clearTimeout(timer); timer=setTimeout(()=>refreshAndBroadcast(target,force).catch(()=>{}),delay); }

  function bindFrames(){
    mapFrames().forEach(frame=>{
      if(boundFrames.has(frame)) return; boundFrames.add(frame);
      frame.addEventListener('load',()=>{setTimeout(()=>refreshAndBroadcast(frame.contentWindow,true).catch(()=>{}),150);});
    });
  }

  function delegateVote(signalId,value){
    const id=String(signalId||''); if(!id) return false;
    const button=document.createElement('button'); button.hidden=true;
    button.dataset.lbVoteSignal=id; button.dataset.lbVoteValue=Number(value)>0?'1':'-1';
    document.body.appendChild(button); button.click(); button.remove(); return true;
  }
  window.addEventListener('message',(event)=>{
    const d=event?.data; if(!d || d.type!=='lb:community:vote-delay') return;
    if(!mapFrames().some(f=>f.contentWindow===event.source)) return;
    if(!canContribute()){document.getElementById('lbBtnOpenAuth')?.click();return;}
    if(delegateVote(d.signalId,d.value)){setTimeout(()=>queue(0,null,true),650);setTimeout(()=>queue(0,null,true),1800);}
  });

  window.addEventListener('lb:community-data-changed',()=>queue(0,null,true));
  window.addEventListener('lb:community-presence-changed',()=>queue(0));
  document.addEventListener('lb:auth-state',()=>queue(0,null,true));
  window.addEventListener('pageshow',()=>{bindFrames();queue(0,null,true);});
  window.addEventListener('hashchange',()=>{bindFrames();queue(0,null,true);});

  function start(){bindFrames();queue(120,null,true);setTimeout(()=>{bindFrames();queue(0);},1100);}
  window.lbCommunityMapVotesV2={refresh:()=>refreshAndBroadcast(null,true),get signals(){return signals.slice();}};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();

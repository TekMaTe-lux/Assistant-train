/* La Bétaillère — dedicated CFL details; never handles SNCF trains. */
(function(){
'use strict';
if(window.lbOpenCflMapDetail)return;
const GTFS='https://vps.labetaillere.fr/api/cfl-trip';
const HIM='https://vps.labetaillere.fr/g/d14c83e7';
let layer=null, token=0, cachedEvents=null, cacheTime=0, pending=null;
const esc=(x)=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=(x)=>{const m=String(x||'').match(/^(\d{1,3}):(\d\d)/);return m?String(Number(m[1])%24).padStart(2,'0')+':'+m[2]:'—';};
function stripMarkup(s){return String(s||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').trim();}
function init(){
 if(layer)return;
 const style=document.createElement('style');
 style.textContent=[
 '.lb-cfl-sheet-bg{position:fixed;inset:0;z-index:200000;background:rgba(0,6,18,.7);display:flex;align-items:flex-end;justify-content:center;color:#ecf9ff;font:500 14px/1.4 Rajdhani,system-ui,sans-serif}',
 '.lb-cfl-sheet-bg[hidden]{display:none!important}',
 '.lb-cfl-sheet{box-sizing:border-box;width:min(650px,100%);max-height:89vh;max-height:89dvh;overflow-y:auto;padding:16px 15px max(20px,env(safe-area-inset-bottom));background:linear-gradient(145deg,#092037,#03101f 68%);border:1px solid #24677c;border-radius:17px 17px 0 0;box-shadow:0 -12px 55px #000b}',
 '.lb-cfl-sheet-hd{position:sticky;top:-16px;z-index:2;display:flex;gap:10px;align-items:center;background:#071a2d;border-bottom:1px solid #24566b;padding:10px 0}',
 '.lb-cfl-sheet-hd h2{margin:0;font-size:20px;font-weight:900;color:#fff}',
 '.lb-cfl-sheet-kicker{font-size:10px;color:#6be3f4;letter-spacing:.12em}',
 '.lb-cfl-sheet-close{margin-left:auto;flex:0 0 36px;width:36px;height:36px;border-radius:10px;border:1px solid #326479;background:#082438;color:#fff;font-size:22px;cursor:pointer}',
 '.lb-cfl-sheet-route{display:flex;justify-content:space-between;gap:12px;align-items:center;background:#0b283d;border:1px solid #29546a;border-radius:11px;padding:11px;margin:13px 0}',
 '.lb-cfl-sheet-route b{font-size:23px;line-height:1.15;display:block;color:#fff}',
 '.lb-cfl-sheet-route small{font-size:12px;color:#b3d3e1}',
 '.lb-cfl-sheet-route i{font-style:normal;color:#5de5f4;font-size:23px}',
 '.lb-cfl-sheet-state{background:#152b3b;border:1px solid #446376;border-radius:9px;padding:10px;font-weight:800;font-size:13px;color:#d9edf6}',
 '.lb-cfl-sheet-state.cancel{background:#421729;color:#ffdee5;border-color:#b84964}',
 '.lb-cfl-sheet-block{margin-top:15px}',
 '.lb-cfl-sheet-block h3{margin:0 0 9px;text-transform:uppercase;font-size:13px;color:#74e9f5;letter-spacing:.07em}',
 '.lb-cfl-sheet-incident{background:#341b2a;border:1px solid #8c445e;border-radius:10px;padding:11px;white-space:pre-line;color:#ffedf1;font-size:13px;line-height:1.5}',
 '.lb-cfl-sheet-incident strong{display:block;font-size:14px;margin-bottom:4px}',
 '.lb-cfl-sheet-stop{display:grid;grid-template-columns:52px 12px minmax(0,1fr) auto;gap:8px;align-items:center;border-left:1px solid #144458;padding:9px 0}',
 '.lb-cfl-sheet-stop .dot{height:10px;width:10px;border-radius:100%;background:#09364a;border:2px solid #55cfe6}',
 '.lb-cfl-sheet-stop b{color:#f5ffff;font-size:13px}.lb-cfl-sheet-stop small{display:block;color:#b0ccd9;font-size:11px}',
 '.lb-cfl-sheet-stop .delay{color:#ffb761;font-weight:900}',
 '.lb-cfl-sheet-note{color:#99b9c9;font-size:11px;margin-top:13px;line-height:1.5}',
 '@media(min-width:760px){.lb-cfl-sheet-bg{align-items:center}.lb-cfl-sheet{border-radius:15px;max-height:80vh}}'
 ].join('\n');
 document.head.appendChild(style);
 layer=document.createElement('div');
 layer.className='lb-cfl-sheet-bg';
 layer.hidden=true;
 layer.innerHTML='<section class="lb-cfl-sheet" role="dialog" aria-modal="true" aria-label="Fiche détaillée CFL" tabindex="-1">'+
 '<div class="lb-cfl-sheet-hd"><div><div class="lb-cfl-sheet-kicker">LA BÉTAILLÈRE · CFL / HAFAS</div><h2 id="lbCflDetailTitle">Train CFL</h2></div>'+
 '<button class="lb-cfl-sheet-close" type="button" aria-label="Fermer la fiche">×</button></div>'+
 '<div id="lbCflDetailRoute"></div><div id="lbCflDetailState" class="lb-cfl-sheet-state"></div>'+
 '<div id="lbCflDetailIncidents"></div><div id="lbCflDetailStops"></div>'+
 '<p class="lb-cfl-sheet-note">Parcours : GTFS CFL (parfois limité à la portion disponible). Retards : observations HAFAS. Suppressions et alternatives : informations trafic HAFAS. Une prévision ne confirme pas un passage réel.</p></section>';
 document.body.appendChild(layer);
 layer.addEventListener('click',e=>{if(e.target===layer||e.target.closest('.lb-cfl-sheet-close'))close();});
 document.addEventListener('keydown',e=>{if(!layer.hidden&&e.key==='Escape')close();});
}
const node=id=>document.getElementById('lbCflDetail'+id);
function close(){if(layer){layer.hidden=true;token++;}}
function showStops(stops,observed,source){
 if(!Array.isArray(stops)||!stops.length){node('Stops').innerHTML='<p>Parcours prévu momentanément indisponible.</p>';return;}
 const first=stops[0],last=stops[stops.length-1];
 node('Route').innerHTML='<div class="lb-cfl-sheet-route"><div><b>'+esc(clock(first.departure||first.arrival))+
 '</b><small>'+esc(first.name)+'</small></div><i>→</i><div style="text-align:right"><b>'+
 esc(clock(last.arrival||last.departure))+'</b><small>'+esc(last.name)+'</small></div></div>';
 const liveByName=new Map((observed||[]).map(s=>[String(s.name||'').toLowerCase(),s]));
 node('Stops').innerHTML='<section class="lb-cfl-sheet-block"><h3>Parcours prévu · '+esc(source)+'</h3>'+
 stops.map(s=>{
  const match=liveByName.get(String(s.name||'').toLowerCase());
  const time=clock(s.departure||s.arrival);
  const delay=match?.delayMinutes;
  const metadata=match?.platform?'Voie '+esc(match.platform):match?.delaySource?'Observation '+esc(match.delaySource):'Horaire théorique';
  return '<div class="lb-cfl-sheet-stop"><b>'+esc(time)+'</b><i class="dot"></i><div><b>'+esc(s.name)+'</b><small>'+metadata+'</small></div>'+
   (delay!=null&&Number.isFinite(Number(delay))?'<span class="delay">'+(Number(delay)>0?'+':'')+esc(Number(delay))+' min</span>':'')+'</div>';
 }).join('')+'</section>';
}
function loadEvents(){
 if(cachedEvents&&Date.now()-cacheTime<120000)return Promise.resolve(cachedEvents);
 if(pending)return pending;
 pending=fetch(HIM,{cache:'no-store',credentials:'omit'})
 .then(r=>{if(!r.ok)throw Error('HAFAS events unavailable');return r.json();})
 .then(j=>{cachedEvents=Array.isArray(j.incidents)?j.incidents:[];cacheTime=Date.now();return cachedEvents;})
 .finally(()=>{pending=null;});
 return pending;
}
function showEvents(rows,number){
 rows=rows.filter(r=>r?.active!==false&&Array.isArray(r.trainNumbers)&&
  r.trainNumbers.some(n=>String(n).replace(/\D/g,'')===number));
 const cancelled=rows.some(r=>/suppression|supprim[eé]/i.test(r.title||''));
 const state=node('State');
 state.classList.toggle('cancel',cancelled);
 state.textContent=cancelled?'⛔ SUPPRESSION SIGNALÉE PAR HAFAS CFL':
 rows.length?'ℹ️ INFORMATION TRAFIC HAFAS':'Aucune suppression confirmée par les alertes HAFAS reçues';
 node('Incidents').innerHTML=rows.length?'<section class="lb-cfl-sheet-block"><h3>Perturbations et alternatives</h3>'+
 rows.slice(0,4).map(r=>'<div class="lb-cfl-sheet-incident"><strong>'+esc(r.title||'Information CFL')+'</strong>'+
 esc(stripMarkup(r.text||r.detail||''))+'</div>').join('')+'</section>':'';
}
async function open(info){
 init();const t=++token;
 layer.hidden=false;
 node('Title').textContent=(info.type||'CFL')+' '+info.number;
 node('State').textContent='Vérification de la situation HAFAS…';
 node('State').classList.remove('cancel');node('Incidents').textContent='';
 showStops(info.fallbackStops||[],info.observedStops||[],'carte');
 layer.querySelector('.lb-cfl-sheet')?.focus({preventScroll:true});
 void loadEvents().then(events=>{if(token===t)showEvents(events,info.number);})
 .catch(()=>{if(token===t)node('State').textContent='Information HAFAS temporairement indisponible';});
 const url=new URL(GTFS);
 url.searchParams.set('date',info.date);
 url.searchParams.set('number',info.number);
 url.searchParams.set('mode','dep');
 if(info.time&&info.time!=='—')url.searchParams.set('time',info.time);
 if(info.destination)url.searchParams.set('place',info.destination);
 const controller=new AbortController();const wait=setTimeout(()=>controller.abort(),6500);
 try{
  const response=await fetch(url.toString(),{cache:'default',credentials:'omit',signal:controller.signal});
  if(!response.ok)throw Error('GTFS CFL HTTP '+response.status);
  const j=await response.json();
  if(token!==t)return;
  if(!j?.ok||!Array.isArray(j.match?.stops)||!j.match.stops.length)throw Error('Parcours introuvable');
  showStops(j.match.stops,info.observedStops||[],'GTFS CFL');
 }catch(e){if(token===t&&!(info.fallbackStops||[]).length)node('Stops').innerHTML='<p>Parcours GTFS indisponible.</p>';}
 finally{clearTimeout(wait);}
}
window.lbOpenCflMapDetail=function(info){
 if(!info||! /^\d{3,6}$/.test(String(info.number||'')))return false;
 void open(info);return true;
};
})();

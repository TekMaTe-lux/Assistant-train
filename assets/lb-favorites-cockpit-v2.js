(() => {
 'use strict';
 const root=document.getElementById('favTrainsWidget');
 if(!root || window.__LB_FAVORITES_COCKPIT_V2__) return;
 window.__LB_FAVORITES_COCKPIT_V2__=true;
 const by=id=>document.getElementById(id);
 const read=el=>String(el?.textContent||'').replace(/\s+/g,' ').trim();
 const make=(tag,cls,text)=>{const el=document.createElement(tag); if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
 function openProfile(kind){const btn=by('favTrain'+kind)?.querySelector('.fav-train-profile-link');if(btn)btn.click();}
 function build(kind){
  const card=by('favCard'+kind);if(!card)return;
  if(card.querySelector('.lbfc-shell'))return;
  card.classList.add('lbfc-card');
  const shell=make('section','lbfc-shell');
  shell.innerHTML=`<div class="lbfc-head"><div class="lbfc-heading"><span class="lbfc-type">TER</span><strong class="lbfc-number">—</strong></div><span class="lbfc-status">Chargement</span></div>
  <div class="lbfc-route">—</div><div class="lbfc-times" aria-live="polite">—</div><div class="lbfc-live"></div>
  <div class="lbfc-metrics"><button type="button" data-metric="composition"><span>COMPOSITION</span><strong class="lbfc-comp-value">—</strong><span class="lbfc-comp-icon"></span></button><button type="button" data-metric="affluence"><span>AFFLUENCE</span><span class="lbfc-aff-value">—</span></button><button type="button" data-metric="fiabilite"><span>FIABILITÉ · 30 J</span><strong class="lbfc-fiab-value">—</strong></button></div>
  <button class="lbfc-open" type="button">Voir la fiche LIVE complète <span>↗</span></button><div class="lbfc-expanded" hidden></div>`;
  card.appendChild(shell);
  shell.querySelector('.lbfc-open').addEventListener('click',()=>openProfile(kind));
  shell.querySelectorAll('[data-metric]').forEach(button=>button.addEventListener('click',()=>{
   const metric=button.dataset.metric;
   if(metric==='composition'){openProfile(kind);return;}
   const target=metric==='fiabilite'?by('favStats'+kind):by('favLine'+kind)?.querySelector('details.fav-aff');
   if(!target){openProfile(kind);return;}
   target.open=!target.open;
   if(metric==='fiabilite'&&target.open)target.setAttribute('data-user-opened','1');
   const wrap=shell.querySelector('.lbfc-expanded');
   wrap.hidden=!target.open;
   wrap.replaceChildren();
   if(target.open){
    const content=metric==='fiabilite'?by('favStatsBody'+kind):target.querySelector('.fav-aff-body');
    if(content)wrap.append(content.cloneNode(true));
   }
   button.setAttribute('aria-expanded',String(target.open));
  }));
  const sources=['favTrain','favState','favMeta','favLine','favStatsSummary','favStatsBody','favCause'].map(k=>by(k+kind)).filter(Boolean);
  let requested=false;
  const schedule=()=>{if(requested)return;requested=true;requestAnimationFrame(()=>{requested=false;refresh(kind);});};
  const observer=new MutationObserver(schedule);
  sources.forEach(el=>observer.observe(el,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','data-train-id']}));
  refresh(kind);
 }
 function refresh(kind){
  const card=by('favCard'+kind),shell=card?.querySelector('.lbfc-shell');if(!shell)return;
  const original=by('favTrain'+kind)?.querySelector('.fav-train-profile-link');
  const number=String(original?.dataset.train||by('favTrain'+kind)?.dataset.trainId||'').match(/\d{5,6}/)?.[0]||'—';
  const meta=by('favMeta'+kind),line=by('favLine'+kind),status=by('favState'+kind),stats=by('favStats'+kind);
  const route=read(meta?.querySelector('.fav-primary-route'))||'Trajet en chargement';
  const times=meta?.querySelector('.fav-primary-times');
  const timeTarget=shell.querySelector('.lbfc-times');
  const content=times?.innerHTML||'';
  if(timeTarget.dataset.value!==content){timeTarget.dataset.value=content;timeTarget.innerHTML=content||'Horaires en chargement';}
  const state=read(status).replace(/TER\s*\d{5,6}/g,'').trim()||'—';
  shell.querySelector('.lbfc-number').textContent=number;
  shell.querySelector('.lbfc-status').textContent=state;
  shell.querySelector('.lbfc-route').textContent=route;
  card.classList.toggle('lbfc-cancel',/supprim|annul/i.test(state));
  const next=read(meta?.querySelector('.fav-next-service'));
  const routeSummary=line?.querySelector('.fav-route-summary');
  const cause=read(line?.querySelector('.fav-cause-inline'))||read(by('favCause'+kind));
  const liveText=[cause,next,read(routeSummary?.querySelector('.fav-route-summary-main')),read(routeSummary?.querySelector('.fav-route-summary-sub'))].filter(Boolean).join(' · ');
  shell.querySelector('.lbfc-live').textContent=liveText||'Consultez la fiche pour le parcours en direct.';
  const reliability=stats?.querySelector('.fav-reliability-pct');
  shell.querySelector('.lbfc-fiab-value').textContent=read(reliability)||'—';
  // Composition: use the exact badge builder shared with existing live train sheets.
  const compValue=shell.querySelector('.lbfc-comp-value');
  const compIcon=shell.querySelector('.lbfc-comp-icon');
  const compSource=typeof window.buildFavTrainTypeBadge==='function' && number!=='—'
    ? window.buildFavTrainTypeBadge(number) : '';
  if(compIcon.dataset.signature!==compSource){
    compIcon.dataset.signature=compSource;compIcon.innerHTML=compSource;
  }
  compValue.textContent=compSource?'Composition prévue':'Indisponible';
  // Occupancy: extract the real percentage and carriage diagram from the existing shared data.
  const aff=typeof window.getAffluenceTrainInfo==='function'&&number!=='—'
    ? window.getAffluenceTrainInfo(number,kind==='AM'?(window.__lbPreferredAffStation||''):(window.__lbPreferredAffTo||'')):null;
  const target=shell.querySelector('.lbfc-aff-value');
  const rawPct=Number(aff?.depPct);
  const pct=Number.isFinite(rawPct)?Math.max(0,Math.min(100,Math.round(rawPct))):null;
  const wagon=aff?.schemaHtml||'';
  const marker=`${number}|${pct}|${wagon}`;
  if(target.dataset.value!==marker){
   target.dataset.value=marker;target.replaceChildren();
   if(pct!==null)target.append(make('strong','lbfc-aff-pct',`${pct} %`));
   if(wagon){const diagram=make('span','lbfc-aff-diagram');diagram.innerHTML=wagon;target.append(diagram);}
   if(pct===null&&!wagon)target.textContent='Indisponible';
  }

 }
 const start=()=>{root.classList.add('lbfc-page');['AM','PM'].forEach(build);};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();

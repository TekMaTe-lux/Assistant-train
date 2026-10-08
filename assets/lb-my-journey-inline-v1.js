(() => {
 'use strict';
 if (window.__lbMyJourneyInline) return;
 window.__lbMyJourneyInline = true;
 const widget=document.getElementById('favTrainsWidget');
 const panel=document.getElementById('trainDetailPanel');
 if(!widget || !panel) return;
 const holder=document.createElement('div'); holder.className='lbmj-holder';
 const controls=document.createElement('div');controls.className='lbmj-controls';
 controls.innerHTML='<div class="lbmj-title">Mon trajet <span>LIVE</span></div><div class="lbmj-select"><button type="button" data-kind="AM">☀ Matin</button><button type="button" data-kind="PM">☾ Soir</button></div><p class="lbmj-note">La fiche du train sélectionné, actualisée depuis les mêmes sources LIVE.</p>';
 widget.prepend(holder); widget.prepend(controls);widget.classList.add('lbmj-page');
 const anchor=document.createComment('original train profile mount'); panel.parentNode.insertBefore(anchor,panel);
 let active=false;let selected='';let changing=false;
 const activePage=()=>window.location.hash.replace('#','').toLowerCase()==='favoris' && widget.getBoundingClientRect().width>0;
 const trainOf=kind=>{const el=document.getElementById('favTrain'+kind);return (el?.dataset.trainId||el?.querySelector('[data-train]')?.dataset.train||'').match(/\d{5,6}/)?.[0]||'';};
 const dateOf=kind=>document.getElementById('favTrain'+kind)?.querySelector('[data-service-date]')?.dataset.serviceDate||'';
 const choose=kind=>{
   if(!active)return;
   selected=kind;controls.querySelectorAll('[data-kind]').forEach(b=>{const is=b.dataset.kind===kind;b.classList.toggle('is-active',is);b.setAttribute('aria-pressed',String(is));});
   const number=trainOf(kind);const date=dateOf(kind);
   if(!number){controls.querySelector('.lbmj-note').textContent='Sélectionne un train favori dans tes préférences.';panel.hidden=true;return;}
   controls.querySelector('.lbmj-note').textContent='Synchronisation de la fiche TER '+number+'…';
   if(typeof window.lbOpenTrainProfile==='function'){
     changing=true;panel.hidden=false;panel.removeAttribute('aria-modal');panel.setAttribute('role','region');panel.setAttribute('aria-hidden','false');
     Promise.resolve(window.lbOpenTrainProfile(number,date,{origin:'favorites'})).catch(()=>{}).finally(()=>{changing=false;if(active)controls.querySelector('.lbmj-note').textContent='Données LIVE du TER '+number;});
   }
 };
 function enter(){
   if(active)return;
   active=true;holder.appendChild(panel);
   panel.classList.add('lbmj-inline');panel.hidden=false;panel.setAttribute('role','region');panel.removeAttribute('aria-modal');panel.setAttribute('aria-hidden','false');
   document.body.classList.remove('lb-train-detail-open','lb-train-detail-from-map');
   // The latest train chosen from the home screen has precedence when available.
   let remembered='';try{remembered=sessionStorage.getItem('lbmj-selected-kind')||'';}catch(_){}
   choose(remembered==='AM'||remembered==='PM'?remembered:(trainOf('PM')?'PM':'AM'));
 }
 function exit(){
   if(!active)return;active=false;
   if(anchor.parentNode)anchor.parentNode.insertBefore(panel,anchor.nextSibling);
   panel.classList.remove('lbmj-inline');panel.hidden=true;panel.setAttribute('aria-hidden','true');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
   document.body.classList.remove('lb-train-detail-open','lb-train-detail-from-map');
 }
 function sync(){if(activePage())enter();else exit();}
 controls.querySelectorAll('[data-kind]').forEach(b=>b.addEventListener('click',()=>{try{sessionStorage.setItem('lbmj-selected-kind',b.dataset.kind);}catch(_){}choose(b.dataset.kind);}));
 document.addEventListener('click',e=>{
   if(!active)return;
   if(e.target?.closest?.('#trainDetailClose')){e.preventDefault();e.stopPropagation();window.location.hash='#home';}
 },true);
 // The original panel is the only live detail instance; when navigating away it returns to its original host.
 document.addEventListener('click',event=>{
   const card=event.target?.closest?.('#homeFavSlot .home-fav-card, #homeFavSlot [data-train], #homeFavSlot [data-train-id], #homeFavSlot [data-kind]');
   if(!card)return;
   const trainNumber=(card.dataset.train||card.dataset.trainId||card.textContent||'').match(/\b\d{5,6}\b/)?.[0]||'';
   const kind=trainNumber&&trainNumber===trainOf('AM')?'AM':trainNumber&&trainNumber===trainOf('PM')?'PM':'';
   if(!kind)return;
   try{sessionStorage.setItem('lbmj-selected-kind',kind);}catch(_){}
   // Preserve the existing home-card behaviour (including its complete modal).
 },true);
 window.addEventListener('lb:my-journey-select',event=>{const kind=event.detail?.kind;if(kind!=='AM'&&kind!=='PM')return;if(!active)sync();if(active)choose(kind);});
 window.addEventListener('hashchange',sync);
 new MutationObserver(()=>{if(!active&&activePage())sync();}).observe(widget,{attributes:true,attributeFilter:['style','class']});
 sync();
})();

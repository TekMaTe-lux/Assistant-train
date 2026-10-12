(() => {
  'use strict';
  if (window.__lbPlanB20261012) return;
  window.__lbPlanB20261012 = true;
  const slot = document.getElementById('homeFavSlot');
  if (!slot) return;
  const API = 'https://vps.labetaillere.fr/api/search-static';
  const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(gare centrale|gare|ville)\b/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const minutes = s => { const m=String(s||'').match(/^(\d\d?):(\d\d)$/);return m?Number(m[1])*60+Number(m[2]):NaN; };
  const dateYmd = () => {
    const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Luxembourg',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const x=Object.fromEntries(parts.map(p=>[p.type,p.value]));return x.year+x.month+x.day;
  };
  const nowMin = () => { const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Luxembourg',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const x=Object.fromEntries(p.map(y=>[y.type,y.value]));return Number(x.hour)*60+Number(x.minute); };
  const escape = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = s => (String(s||'').match(/\b\d{4,6}\b/)||[])[0]||'';
  const bestDate = () => dateYmd();
  let modal, previousFocus;
  function showModal() {
    if (!modal) {
      modal=document.createElement('div');modal.className='lbpb-backdrop';
      modal.innerHTML='<section class="lbpb-dialog" role="dialog" aria-modal="true" aria-label="Plan B ferroviaire"><header><span>🐂 PLAN B · LA BÉTAILLÈRE</span><button type="button" class="lbpb-close" aria-label="Fermer">✕</button></header><div class="lbpb-content" aria-live="polite"></div></section>';
      document.body.append(modal);
      modal.querySelector('.lbpb-close').addEventListener('click',closeModal);
      modal.addEventListener('click',e=>{if(e.target===modal)closeModal();});
    }
    previousFocus=document.activeElement;modal.hidden=false;document.body.classList.add('lbpb-open');modal.querySelector('.lbpb-close').focus();
  }
  function closeModal() {if(modal){modal.hidden=true;document.body.classList.remove('lbpb-open');previousFocus?.focus?.();}}
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal&&!modal.hidden)closeModal();});
  function routeFor(kind, row) {
    const route=document.getElementById('favMeta'+kind)?.querySelector('.fav-primary-route')?.textContent
      || row.querySelector('.home-fav-route')?.dataset.lb4RawRoute || row.querySelector('.home-fav-route')?.getAttribute('aria-label') || '';
    const m=String(route).match(/^(.+?)\s*(?:→|➜|›|->|\s+vers\s+)\s*(.+)$/i);
    return m?{from:m[1].trim(),to:m[2].trim()}:null;
  }
  function isCancelled(kind,row) {
    const text=document.getElementById('favState'+kind)?.textContent||'';
    const source=document.getElementById('favCard'+kind);
    if (/partiel|partial/i.test(text)) return false;
    return /SUPPRIM|ANNUL|CANCEL/i.test(text)||source?.classList.contains('is-canceled')||row.classList.contains('is-cancelled');
  }
  function candidate(t,excluded,earliest) {
    return t && t.train && String(t.train)!==excluded && Number.isFinite(t.depMin) && Number.isFinite(t.arrMin) && t.depMin>=earliest && t.arrMin>t.depMin && !t.endpointFallback;
  }
  function renderTrip(t,label,extra) {
    return '<article class="lbpb-trip"><div class="lbpb-triphead"><strong>'+escape(label)+'</strong><span>'+escape(extra||'')+'</span></div><div class="lbpb-hours">'+escape(t.dep)+' → '+escape(t.arr)+'</div><div class="lbpb-leg">'+escape(t.train)+' · '+escape(t.from)+' → '+escape(t.to)+'</div></article>';
  }
  async function openPlan(kind,row) {
    const route=routeFor(kind,row);
    const out=()=>modal.querySelector('.lbpb-content');
    showModal();
    if(!route||!route.from||!route.to||normalize(route.from)===normalize(route.to)){out().textContent='Trajet indisponible : origine ou destination introuvable.';return;}
    const favNo=number(document.getElementById('favTrain'+kind)?.textContent||row.querySelector('.home-fav-train-no')?.textContent);
    out().innerHTML='<h3>'+escape(route.from)+' → '+escape(route.to)+'</h3><p class="lbpb-note">Recherche des prochains itinéraires…</p>';
    const date=bestDate(), earliest=nowMin()+4;
    const qs=new URLSearchParams({from:route.from,to:route.to,date,start:'00:00',end:'23:59',includeCfl:'1',allowTransfers:'1',minTransfer:'10',maxTransfer:'45',transferLimit:'50'});
    try {
      const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),9000);
      let response;try{response=await fetch(API+'?'+qs,{signal:controller.signal,cache:'no-store'});}finally{clearTimeout(timeout);}
      if(!response.ok) throw Error('API '+response.status);
      const data=await response.json();
      const directs=(data.directs||[]).filter(t=>candidate(t,favNo,earliest)).sort((a,b)=>a.arrMin-b.arrMin||a.depMin-b.depMin);
      const direct=directs[0];
      // Un changement n'est proposé que s'il donne un vrai avantage à l'arrivée.
      // Complément : le classement global de l'API peut omettre un bon trajet via Metz.
      // Deux recherches ciblées, uniquement à l'ouverture du panneau (pas au chargement de la page).
      let viaMetz = [];
      if(normalize(route.from)!=='metz' && normalize(route.to)!=='metz'){
        try {
          const legParams = (from,to) => new URLSearchParams({from,to,date,start:'00:00',end:'23:59',includeCfl:'1'});
          const [r1,r2]=await Promise.all([
            fetch(API+'?'+legParams(route.from,'Metz'),{cache:'no-store'}),
            fetch(API+'?'+legParams('Metz',route.to),{cache:'no-store'})
          ]);
          if(r1.ok && r2.ok){
            const [left,right]=await Promise.all([r1.json(),r2.json()]);
            const first=(left.directs||[]).filter(t=>candidate(t,favNo,earliest));
            const second=(right.directs||[]).filter(t=>candidate(t,favNo,earliest));
            for(const a of first){
              for(const b of second){
                const wait=b.depMin-a.arrMin;
                if(wait>=10&&wait<=45&&a.tripId!==b.tripId&&(!direct||b.arrMin<=direct.arrMin-12)){
                  viaMetz.push({first:a,second:b});
                }
              }
            }
          }
        }catch(_){ /* L'itinéraire direct reste disponible. */ }
      }
      const transfers=[...(data.transfers||[]),...viaMetz].filter(t=>{
        const a=t.first,b=t.second;
        if(!candidate(a,favNo,earliest)||!candidate(b,favNo,earliest))return false;
        if(normalize(a.to)!==normalize(b.from)||normalize(a.from)!==normalize(route.from)||normalize(b.to)!==normalize(route.to))return false;
        if(a.tripId===b.tripId)return false;
        const wait=b.depMin-a.arrMin;
        if(wait<10||wait>45||b.arrMin<=a.depMin) return false;
        return !direct || b.arrMin<=direct.arrMin-12;
      }).sort((a,b)=>a.second.arrMin-b.second.arrMin||a.first.depMin-b.first.depMin);
      const transfer=transfers[0];
      let markup='<h3>'+escape(route.from)+' → '+escape(route.to)+'</h3>';
      if(transfer && (!direct||transfer.second.arrMin<direct.arrMin)){
        markup+='<article class="lbpb-trip"><div class="lbpb-triphead"><strong>Arriver plus tôt · 1 correspondance</strong><span>Via '+escape(transfer.first.to)+'</span></div><div class="lbpb-hours">'+escape(transfer.first.dep)+' → '+escape(transfer.second.arr)+'</div><div class="lbpb-leg">'+escape(transfer.first.train)+' · '+escape(transfer.first.from)+' → '+escape(transfer.first.to)+'</div><div class="lbpb-change">'+(transfer.second.depMin-transfer.first.arrMin)+' min de correspondance</div><div class="lbpb-leg">'+escape(transfer.second.train)+' · '+escape(transfer.second.from)+' → '+escape(transfer.second.to)+'</div></article>';
      }
      if(direct)markup+=renderTrip(direct,transfer?'Autre option · Direct':'Prochain direct','Sans correspondance');
      if(!direct&&transfer)markup+='<p class="lbpb-note">Vérifie les deux trains et la correspondance avant de partir.</p>';
      if(!direct&&!transfer)markup+='<p class="lbpb-note">Aucun itinéraire fiable trouvé pour le moment. Consulte le tableau des départs.</p>';
      markup+='<p class="lbpb-disclaimer">Horaires théoriques non confirmés en LIVE. Vérifie les suppressions, les retards et les voies avant de partir. Une correspondance n’est jamais garantie.</p>';
      if(modal&&!modal.hidden)out().innerHTML=markup;
    } catch(e){if(modal&&!modal.hidden)out().innerHTML='<h3>'+escape(route.from)+' → '+escape(route.to)+'</h3><p class="lbpb-note">Recherche momentanément indisponible. Consulte le tableau des départs.</p>';}
  }
  function decorate(){
    slot.querySelectorAll('.home-fav-row').forEach(row=>{
      const kind=row.dataset.favK;
      const link=row.querySelector('.lb-home-fav-alternative');
      if(!link||!kind||!isCancelled(kind,row))return;
      if(link.dataset.lbpbAttached==='1')return;
      link.dataset.lbpbAttached='1';link.textContent='🐂 PLAN B →';link.setAttribute('href','#');link.setAttribute('aria-label','Voir les prochains trajets possibles');
      link.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();openPlan(kind,row);});
      link.addEventListener('keydown',event=>event.stopPropagation());
    });
  }
  let queued=false;
  new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;decorate();});}).observe(slot,{childList:true,subtree:true});
  decorate();
})();
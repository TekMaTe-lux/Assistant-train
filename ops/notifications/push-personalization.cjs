'use strict';
const normalize=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
function favoritePayload(num,event,stops,prefs,win,visible) {
  const names=Object.keys(stops||{}), from=names.findIndex(s=>normalize(s)===normalize(prefs.from)),to=names.findIndex(s=>normalize(s)===normalize(prefs.to));
  const mapped=from>=0&&to>=0;
  const first=mapped?Math.min(from,to):-1,last=mapped?Math.max(from,to):-1;
  const trip=mapped?`${names[first]} → ${names[last]}`:`${visible.from||win.origin} → ${visible.to||win.destination}`;
  let title,body;
  if(event.type==='cancel') {title=`❌ Ton favori ${num} est supprimé`;body=`Ton trajet ${trip} : ce train est annoncé supprimé. Consulte sa fiche avant de partir.`;}
  else if(event.type==='partial_cancel') {title=`⚠️ Ton favori ${num} : desserte modifiée`;body=`Ton trajet ${trip} est concerné par une suppression de desserte entre ${visible.from||win.origin} et ${visible.to||win.destination}. Vérifie les arrêts maintenus sur sa fiche.`;}
  else {
    const segment=mapped?names.slice(first,last+1):names;
    const delay=mapped?Math.max(0,...segment.map(s=>Number(stops[s])||0)):event.delay;
    if(mapped&&delay<10)return null;
    title=`⏱️ Ton favori ${num} : +${delay} min`;
    body=`Ton trajet ${trip} : jusqu’à +${delay} min annoncées.`;
    if(mapped) {
      const at=s=>{const n=Number(stops[s]);return stops[s]!==null&&stops[s]!==undefined&&Number.isFinite(n)?`+${Math.max(0,n)} min`:'non précisé'};
      body+=` Départ de ${names[first]} : ${at(names[first])}. Arrivée à ${names[last]} : ${at(names[last])}.`;
    }
    body+=' Consulte la fiche pour suivre l’évolution.';
  }
  return {title,body,tag:`lb-favorite-${num}-${event.type}`,url:`/#live?train=${encodeURIComponent(num)}`};
}
module.exports={favoritePayload};

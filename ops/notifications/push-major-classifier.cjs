'use strict';
const window={};
window.LBWorkNoticeState = window.LBWorkNoticeState || ((event, now = Date.now()) => {
  const text = ['summary','title','description','text','detail','header_text','description_text','detail_html']
    .map(key => String(event?.[key] || '').replace(/<[^>]*>/g, ' '))
    .join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  if (event?.kind !== 'travaux' && !/\btravaux\b|operations programmees|chantier/.test(text)) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  }).formatToParts(new Date(now)).map(part => [part.type, part.value]));
  const wallNow = Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
  const months = {janvier:1,fevrier:2,mars:3,avril:4,mai:5,juin:6,juillet:7,aout:8,septembre:9,octobre:10,novembre:11,decembre:12};
  const M = '(?:'+Object.keys(months).join('|')+')';
  const W = '(?:(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\\s+)?';
  const T = '(?:\\s+(?:a\\s+)?(\\d{1,2})[h:](\\d{2})?)?';
  const date = (day,month,year,hour,minute,end=false) => {
    const y=+(year || parts.year),m=months[month],d=+day,h=+(hour || 0),n=+(minute || 0);
    const value=Date.UTC(y,m-1,d,h,n);
    const check=new Date(value);
    if (!m || check.getUTCFullYear()!==y || check.getUTCMonth()!==m-1 || check.getUTCDate()!==d || h>23 || n>59) return null;
    return value + (end && hour == null ? 86400000-1 : 0);
  };
  const intervals=[];
  let remaining=text;
  const range=new RegExp('(?:du|depuis le|a partir du)\\s+'+W+'(\\d{1,2})(?:er)?(?:\\s+('+M+'))?(?:\\s+(\\d{4}))?'+T+'\\s+(?:au|jusqu[\\s\\x27]*au)\\s+'+W+'(\\d{1,2})(?:er)?\\s+('+M+')(?:\\s+(\\d{4}))?'+T,'g');
  for (const match of text.matchAll(range)) {
    const [,d1,m1,y1,h1,n1,d2,m2,y2,h2,n2]=match;
    const a=date(d1,m1 || m2,y1 || y2,h1,n1),b=date(d2,m2,y2 || y1,h2,n2,true);
    if(a!==null && b!==null && b>=a) { intervals.push([a,b]); remaining=remaining.replace(match[0],' '); }
  }
  const discrete=new RegExp('(?<!\\d)(\\d{1,2}(?:er)?(?:\\s*(?:et|&|/|-)\\s*\\d{1,2})*)\\s+('+M+')(?:\\s+(\\d{4}))?','g');
  for(const match of remaining.matchAll(discrete)) {
    for(const day of match[1].match(/\d{1,2}/g)) {
      const a=date(day,match[2],match[3]),b=date(day,match[2],match[3],null,null,true);
      if(a!==null && b!==null) intervals.push([a,b]);
    }
  }
  if(!intervals.length) return null;
  if(intervals.some(([a,b]) => a<=wallNow && wallNow<=b)) return 'active';
  return intervals.some(([a]) => a>wallNow) ? 'upcoming' : 'ended';
});


  const normalize = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const activeNow = (situation, now) => {
    const workState = window.LBWorkNoticeState(situation, now);
    if (workState === 'upcoming' || workState === 'ended') return false;
    const periods = Array.isArray(situation?.validity_periods)
      ? situation.validity_periods
      : [];
    if (!periods.length) return false;
    return periods.some((period) => {
      const start = Date.parse(period?.start || '');
      const end = Date.parse(period?.end || '');
      return (!Number.isFinite(start) || start <= now)
        && (!Number.isFinite(end) || now <= end);
    });
  };

  const affectedTrainNumbers = (situation) => {
    const numbers = new Set();
    (Array.isArray(situation?.affects) ? situation.affects : []).forEach((affected) => {
      (Array.isArray(affected?.vehicle_journeys) ? affected.vehicle_journeys : [])
        .forEach((ref) => {
          const match = String(ref || '').match(/(?:^|\D)(\d{5,6})(?:\D|$)/);
          if (match) numbers.add(match[1]);
        });
    });
    return numbers;
  };

  const isCorridorTrain = (number) =>
    /^(?:885\d{2}|887\d{2}|888\d{2}|837[56]\d{2}|8340\d{2})$/.test(String(number || ''));

  const CORRIDOR_PLACE_GROUPS = [
    ['nancy'], ['champigneulles'], ['frouard'], ['pompey'], ['dieulouard'],
    ['pont-a-mousson', 'pont a mousson'], ['pagny-sur-moselle', 'pagny'],
    ['noveant'], ['ars-sur-moselle'], ['metz'], ['woippy'], ['maizieres-les-metz'],
    ['hagondange'], ['uckange'], ['thionville'], ['hettange-grande', 'hettange'],
    ['zoufftgen'], ['bettembourg'], ['luxembourg']
  ];
  const OUTSIDE_CORRIDOR_PLACES = [
    'varangeville', 'luneville', 'saint-nicolas-de-port', 'saint nicolas de port',
    'dombasle', 'blainville', 'epinal', 'remiremont', 'saint-die', 'saint die',
    'sarrebourg', 'saverne', 'strasbourg', 'bar-le-duc', 'bar le duc',
    'toul', 'longwy', 'verdun'
  ];

  const corridorPlacesIn = (text) => CORRIDOR_PLACE_GROUPS
    .filter((aliases) => aliases.some((place) => text.includes(place)))
    .map((aliases) => aliases[0]);

  const isCorridorText = (text) => corridorPlacesIn(text).length > 0;

  // Certains broadcasts SIRI régionaux associent des centaines de trains à un
  // chantier local. Un unique terminus du corridor (ex. Nancy) ne suffit pas :
  // l'alerte doit citer au moins deux points du sillon si elle mentionne une zone extérieure.
  const isOutsideCorridorOnly = (text) => {
    const hasOutsidePlace = OUTSIDE_CORRIDOR_PLACES.some((place) => text.includes(place));
    if (!hasOutsidePlace) return false;
    return corridorPlacesIn(text).length < 2;
  };

  const hasMajorImpact = (text) =>
    /(tous les trains[^.]{0,90}(supprim|remplac)|interruption (totale|des circulations)|circulation[^.]{0,80}(interromp|tres perturbee|très perturbée)|aucun train|nombreuses suppressions|remplac[ée]s? par des cars|forts? retards?|retards? importants?)/.test(text);

  // Même hiérarchie et mêmes couleurs que les cartes de l'onglet Perturbations.
  const severityFor = (text) => {
    if (/(tous les trains[^.]{0,100}supprim|interruption totale|aucun train|circulation[^.]{0,80}interromp)/.test(text)) {
      return { key: 'critical', icon: '❌', label: 'Circulation interrompue', rank: 5 };
    }
    if (/circulation[^.]{0,100}perturbee/.test(text) && /suppressions?/.test(text)) {
      return { key: 'critical', icon: '⚠️', label: 'Service perturbé', rank: 5 };
    }
    if (/(service reduit|service modifie|nombreuses suppressions|remplac[ée]s? par des cars)/.test(text)) {
      return { key: 'warning', icon: '⚠️', label: 'Service réduit', rank: 4 };
    }
    if (/(forts? retards?|retards? importants?)/.test(text)) {
      return { key: 'delay', icon: '⏰', label: 'Retards importants', rank: 3 };
    }
    if (/travaux/.test(text)) {
      return { key: 'works', icon: '🔧', label: 'Travaux', rank: 2 };
    }
    return { key: 'info', icon: 'ℹ️', label: 'Information trafic', rank: 1 };
  };

  function classify(situation){
    const fullText = [
      situation?.summary,
      situation?.description,
      situation?.detail
    ].filter(Boolean).join(' ');
    const text = normalize(fullText);
    const allTrains = affectedTrainNumbers(situation);
    const corridorTrains = Array.from(allTrains).filter(isCorridorTrain);
    const participant = String(situation?.participant_ref || '').toUpperCase();
    const scope = String(situation?.scope_type || '').toLowerCase();

    if (isOutsideCorridorOnly(text)) return null;

    const relevant = corridorTrains.length > 0
      || ((participant === 'LOR' || scope === 'general') && isCorridorText(text));
    const broad = scope === 'general' || corridorTrains.length >= 8;

    // Les messages SIRI Lorraine sont parfois rédigés de façon très sobre
    // ("circulation perturbée", "des suppressions sont à prévoir") sans employer
    // les mots "très perturbée". Si LOR cite au moins deux points du Sillon et
    // annonce un impact réel sur la circulation, on le traite comme majeur #BER.
    const lorraineCorridorImpact = participant === 'LOR'
      && corridorPlacesIn(text).length >= 2
      && /(circulation[^.]{0,100}perturbee|suppressions?|interruption|retards?)/.test(text);

    const major = hasMajorImpact(text) || lorraineCorridorImpact;

    if (!relevant || !broad || !major) return null;

    return {
      situation,
      text,
      corridorTrains,
      severity: severityFor(text),
      // Les broadcasts SIRI peuvent publier le même incident une fois en scope
      // général puis une seconde fois avec les trains affectés. La description
      // est plus stable que le détail : on neutralise seulement le préfixe
      // régional pour fusionner ces vrais doublons sans masquer deux incidents.
      fingerprint: normalize(situation?.description || situation?.detail || situation?.summary || '')
        .replace(/^lorraine\s*:\s*/, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    };
  }


module.exports={classifyActive:(data,now=Date.now())=>(data.situations||[])
.filter(s=>activeNow(s,now)).map(classify).filter(Boolean), workState:window.LBWorkNoticeState};

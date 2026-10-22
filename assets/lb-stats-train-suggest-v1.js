/* LB_STATS_TRAIN_SUGGEST_20261022
 * Complète uniquement la saisie du TER SNCF dans l'onglet Mon train.
 * Le calcul statistique existant continue à recevoir un numéro numérique.
 */
(() => {
  'use strict';

  function initialize() {
    const input = document.getElementById('statsV2TrainInput');
    const source = document.getElementById('statsV2TrainSource');
    const analyze = document.getElementById('statsV2TrainRun');
    const field = input?.closest('.stats-v2__field');
    if (!input || !field || field.querySelector('.lb-stats-train-suggest')) return;

    const style = document.createElement('style');
    style.textContent = `
      #statsV2TrainPanel .lb-stats-train-combo { position:relative; z-index:25; }
      #statsV2TrainPanel .lb-stats-train-suggest[hidden] { display:none !important; }
      #statsV2TrainPanel .lb-stats-train-suggest {
        position:absolute; top:calc(100% + 5px); left:0; right:0; z-index:50;
        background:#031721; border:1px solid rgba(73,224,238,.58);
        box-shadow:0 12px 32px rgba(0,0,0,.55);
        border-radius:12px; overflow:hidden; color:#e4faff;
        font-family:Rajdhani,system-ui,sans-serif; min-width:min(325px,90vw);
      }
      #statsV2TrainPanel .lb-stats-train-suggest__header {
        padding:8px 12px; font-size:11px; font-weight:700; color:#91bfc8;
        border-bottom:1px solid rgba(103,212,223,.15);
      }
      #statsV2TrainPanel .lb-stats-train-suggest__results {
        max-height:275px; overflow-y:auto; overscroll-behavior:contain;
      }
      /* Chaque train est UNE ligne de texte : ni badge, ni carte, ni étiquette. */
      #statsV2TrainPanel .lb-stats-train-suggest__item {
        display:block; width:100%; padding:7px 10px; text-align:left;
        background:transparent; color:#e2f8fb; border:0;
        border-bottom:1px solid rgba(106,213,227,.12);
        border-radius:0;
        cursor:pointer; font:600 12.5px/1.35 Rajdhani,system-ui,sans-serif;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      }
      #statsV2TrainPanel .lb-stats-train-suggest__item:hover,
      #statsV2TrainPanel .lb-stats-train-suggest__item.is-active {
        background:rgba(34,151,182,.24); outline:none;
      }
      @media(max-width:540px){
        #statsV2TrainPanel .lb-stats-train-suggest { min-width:0; }
        #statsV2TrainPanel .lb-stats-train-suggest__results { max-height:260px; }
        #statsV2TrainPanel .lb-stats-train-suggest__item { font-size:11.4px; padding:8px 7px; }
      }
    `;
    document.head.appendChild(style);

    field.classList.add('lb-stats-train-combo');
    const menu = document.createElement('div');
    menu.id = 'lbStatsTrainSuggestions';
    menu.className = 'lb-stats-train-suggest';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', 'Trains SNCF et horaires théoriques');
    menu.hidden = true;
    const header = document.createElement('div');
    header.className = 'lb-stats-train-suggest__header';
    const results = document.createElement('div');
    results.className = 'lb-stats-train-suggest__results';
    menu.append(header, results);
    field.appendChild(menu);

    input.removeAttribute('maxlength');
    input.setAttribute('inputmode', 'text');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', menu.id);
    input.setAttribute('aria-expanded', 'false');
    input.placeholder = 'Numéro, gare ou heure (ex. Nancy)';
    let catalog = null;
    let loading = null;
    let matches = [];
    let active = 0;
    let hasFocus = false;

    const normalized = value => String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('fr-FR')
      .replace(/(\d{1,2})h(\d{2})/g, '$1:$2')
      .trim();
    const isSncf = () => source?.value !== 'cfl' && !input.hidden;
    const hide = () => {
      menu.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    };
    const show = () => {
      if (!isSncf() || !hasFocus) return;
      menu.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };
    const stamp = time => {
      const parts = /^(\d+):(\d{2})$/.exec(String(time || ''));
      if (!parts) return String(time || '').replace(':','h');
      const hour = Number(parts[1]);
      return String(hour % 24).padStart(2, '0') + 'h' + parts[2] +
        (hour >= 24 ? ' +1j' : '');
    };

    function select(train) {
      input.value = train[0];
      input.dispatchEvent(new Event('input', { bubbles:true }));
      input.dispatchEvent(new Event('change', { bubbles:true }));
      hide();
    }

    function paint() {
      if (!catalog || !isSncf()) return;
      const search = normalized(input.value);
      const terms = search.split(/\s+/).filter(Boolean);
      const scored = [];
      for (const row of catalog) {
        const [number, origin, departure, destination, arrival] = row;
        const haystack = normalized([number, origin, departure, destination, arrival,
          stamp(departure), stamp(arrival)].join(' '));
        if (!terms.every(term => haystack.includes(term))) continue;
        const start = normalized(origin).startsWith(search);
        const numberMatch = number.startsWith(search);
        scored.push({ row, priority: numberMatch ? 0 : start ? 1 : 2 });
      }
      // Horaires croissants même quand la gare est en destination : le soir reste visible.
      scored.sort((a,b)=>
        (/^\d/.test(search) ? a.priority-b.priority : 0) ||
        a.row[2].localeCompare(b.row[2]) ||
        a.row[0].localeCompare(b.row[0],undefined,{numeric:true}));
      matches = scored.map(item=>item.row);
      active = 0;
      // Aucun plafond : tous les trains et variantes lundi→dimanche restent accessibles.
      const visible = matches;
      header.textContent = search
        ? (matches.length ? matches.length + ' horaire(s) · lundi à dimanche'
          : 'Aucun train trouvé — essaie une autre gare ou heure')
        : 'Tous les trains du Sillon · lundi à dimanche';
      results.replaceChildren();
      for (const [i, row] of visible.entries()) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'lb-stats-train-suggest__item' + (i === active ? ' is-active' : '');
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(i === active));
        const line = row[0] + '  ' + row[1] + ' ' + stamp(row[2]) +
          ' → ' + row[3] + ' ' + stamp(row[4]);
        item.textContent = line;
        const weekdays = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];
        item.title = line + (Array.isArray(row[5]) ?
          ' · ' + row[5].map(day => weekdays[day]).filter(Boolean).join(', ') : '');
        item.addEventListener('pointerdown',event=>event.preventDefault());
        item.addEventListener('click',()=>select(row));
        results.appendChild(item);
      }
      show();
    }

    function highlight(index) {
      active = (index + matches.length) % matches.length;
      [...results.children].forEach((item,i)=>{
        item.classList.toggle('is-active',i===active);
        item.setAttribute('aria-selected',String(i===active));
        if (i===active) item.scrollIntoView({block:'nearest'});
      });
    }

    async function load() {
      if (catalog) return catalog;
      if (loading) return loading;
      header.textContent = 'Chargement des horaires théoriques…';
      results.replaceChildren();
      show();
      loading = fetch('https://vps.labetaillere.fr/g/9c2e10b5',{
        method:'GET', mode:'cors', credentials:'omit'
      }).then(async response=>{
        if (!response.ok) throw new Error('Catalogue indisponible');
        const data = await response.json();
        if (!Array.isArray(data?.trains) || !data.trains.length) throw new Error('Catalogue vide');
        catalog = data.trains.filter(row=>Array.isArray(row) && row.length >= 5 &&
          /^\d{4,6}$/.test(row[0]));
        // Le datalist historique (top trains) demeure la solution de repli si l'API échoue.
        input.removeAttribute('list');
        paint();
        return catalog;
      }).catch(()=>{
        header.textContent = 'Recherche par gare indisponible. Saisis le numéro du TER.';
        results.replaceChildren();
        show();
        loading = null;
        return null;
      });
      return loading;
    }

    input.addEventListener('focus',()=>{
      hasFocus = true;
      if (isSncf()) {
        if (catalog) paint();
        else load();
      }
    });
    input.addEventListener('input',()=>{
      if (catalog) paint();
      else if (isSncf()) load();
    });
    input.addEventListener('keydown',event=>{
      if (!menu.hidden && matches.length) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          highlight(active + (event.key === 'ArrowDown' ? 1 : -1));
        } else if (event.key === 'Enter') {
          event.preventDefault();
          event.stopImmediatePropagation();
          select(matches[active] || matches[0]);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          hide();
        }
      } else if (event.key === 'Enter' && !/^\d{4,6}$/.test(input.value.trim())) {
        // N'envoie jamais une gare, une heure ou une recherche partielle à l'API de stats.
        event.preventDefault();
        event.stopImmediatePropagation();
        if (catalog) paint();
      }
    }, true);
    analyze?.addEventListener('click',event=>{
      if (!isSncf() || /^\d{4,6}$/.test(input.value.trim())) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (catalog) paint();
      else load();
      input.focus();
    },true);
    source?.addEventListener('change',()=>{
      hide();
      if (isSncf() && document.activeElement===input && catalog) paint();
    });
    input.addEventListener('blur',()=>{
      hasFocus=false;
      window.setTimeout(()=>{if (!hasFocus) hide();},120);
    });
    document.addEventListener('pointerdown',event=>{
      if (!field.contains(event.target)) hide();
    });
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded',initialize,{once:true});
  else initialize();
})();

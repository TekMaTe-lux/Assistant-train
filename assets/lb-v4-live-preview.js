(() => {
  'use strict';

  const frame = document.getElementById('lbV4LiveFrame');
  const status = document.getElementById('lbV4LiveStatus');
  const reload = document.getElementById('lbV4Reload');
  const openProd = document.getElementById('lbV4OpenProd');
  const BASE_CSS_HREF = '/assets/lb-v4-live-preview.css?v=20260827-3';
  const HARMONY_CSS_HREF = '/assets/lb-v4-cockpit-live.css?v=20260827-3';
  const HARMONY_JS_HREF = '/assets/lb-v4-cockpit-live.js?v=20260827-3';

  function setStatus(text, type = '') {
    if (!status) return;
    status.textContent = text;
    status.dataset.state = type;
  }

  function ensureStylesheet(doc, id, href) {
    let link = doc.getElementById(id);
    if (!link) {
      link = doc.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      doc.head.appendChild(link);
    }
    if (link.href !== new URL(href, location.origin).href) link.href = href;
    return link;
  }

  function ensureScript(doc, id, src) {
    let script = doc.getElementById(id);
    if (script) return script;
    script = doc.createElement('script');
    script.id = id;
    script.src = src;
    script.defer = true;
    (doc.body || doc.head).appendChild(script);
    return script;
  }

  function inject() {
    let doc;
    try {
      doc = frame.contentDocument || frame.contentWindow.document;
    } catch (err) {
      setStatus('ERREUR SAME-ORIGIN', 'error');
      console.error('[LB V4 live preview] accès iframe refusé', err);
      return;
    }
    if (!doc || !doc.documentElement) {
      setStatus('INDEX NON DISPONIBLE', 'error');
      return;
    }

    doc.documentElement.dataset.lbV4Live = '1';
    if (doc.body) doc.body.dataset.lbV4Live = '1';

    ensureStylesheet(doc, 'lbV4LivePreviewCss', BASE_CSS_HREF);
    ensureStylesheet(doc, 'lbV4CockpitLiveCss', HARMONY_CSS_HREF);
    ensureScript(doc, 'lbV4CockpitLiveJs', HARMONY_JS_HREF);

    let meta = doc.querySelector('meta[name="robots"][data-lb-v4-preview]');
    if (!meta) {
      meta = doc.createElement('meta');
      meta.name = 'robots';
      meta.content = 'noindex,nofollow,noarchive';
      meta.dataset.lbV4Preview = '1';
      doc.head.appendChild(meta);
    }

    setStatus('INDEX RÉEL · V4 HARMONISÉE', 'ok');
    document.documentElement.dataset.ready = '1';

    const checks = {
      tableau: !![...doc.querySelectorAll('h1,h2,h3')].find(el => /tableau dynamique/i.test(el.textContent || '')),
      favoris: !![...doc.querySelectorAll('h1,h2,h3')].find(el => /bétaillères favorites/i.test(el.textContent || '')),
      live: !![...doc.querySelectorAll('h1,h2,h3,button')].find(el => /voix du bétail|signaler/i.test(el.textContent || '')),
      stats: !![...doc.querySelectorAll('h1,h2,h3')].find(el => /statistiques|ponctualité/i.test(el.textContent || '')),
      carte: !!doc.querySelector('iframe[title*="Carte" i], #carte, [aria-label*="Carte" i]')
    };
    console.info('[LB V4 live preview] fonctions index détectées', checks);
  }

  frame?.addEventListener('load', () => {
    setStatus('HARMONISATION…');
    requestAnimationFrame(() => requestAnimationFrame(inject));
  });

  reload?.addEventListener('click', () => {
    setStatus('ACTUALISATION…');
    try { frame.contentWindow.location.reload(); }
    catch (_) { frame.src = frame.src; }
  });

  openProd?.addEventListener('click', () => window.open('/', '_blank', 'noopener'));
})();

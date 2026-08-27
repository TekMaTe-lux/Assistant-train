(() => {
  'use strict';

  const frame = document.getElementById('lbV4LiveFrame');
  const status = document.getElementById('lbV4LiveStatus');
  const reload = document.getElementById('lbV4Reload');
  const openProd = document.getElementById('lbV4OpenProd');
  const CSS_HREF = '/assets/lb-v4-live-preview.css?v=20260827-1';

  function setStatus(text, type = '') {
    if (!status) return;
    status.textContent = text;
    status.dataset.state = type;
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

    let link = doc.getElementById('lbV4LivePreviewCss');
    if (!link) {
      link = doc.createElement('link');
      link.id = 'lbV4LivePreviewCss';
      link.rel = 'stylesheet';
      link.href = CSS_HREF;
      doc.head.appendChild(link);
    }

    let meta = doc.querySelector('meta[name="robots"][data-lb-v4-preview]');
    if (!meta) {
      meta = doc.createElement('meta');
      meta.name = 'robots';
      meta.content = 'noindex,nofollow,noarchive';
      meta.dataset.lbV4Preview = '1';
      doc.head.appendChild(meta);
    }

    setStatus('INDEX RÉEL + V4', 'ok');
    document.documentElement.dataset.ready = '1';

    // Diagnostic non intrusif : on vérifie uniquement la présence des grands blocs.
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
    setStatus('INJECTION V4…');
    requestAnimationFrame(() => requestAnimationFrame(inject));
  });

  reload?.addEventListener('click', () => {
    setStatus('ACTUALISATION…');
    try { frame.contentWindow.location.reload(); }
    catch (_) { frame.src = frame.src; }
  });

  openProd?.addEventListener('click', () => window.open('/', '_blank', 'noopener'));

  window.addEventListener('message', event => {
    if (event.origin !== location.origin) return;
    if (event.data?.type === 'lb-v4-preview-ready') setStatus('INDEX RÉEL + V4', 'ok');
  });
})();

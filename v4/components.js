(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const train = {
    number: '88742', status: 'delay', delayMinutes: 7, live: true,
    origin: { name: 'Metz' }, destination: { name: 'Luxembourg', platform: '8' },
    composition: { code: 'US5', confidence: 'estimated' }, occupancy: { percent: 78 },
    stops: [
      { name: 'Metz', delayMinutes: 7, platform: '2' },
      { name: 'Maizières-lès-Metz', delayMinutes: 7 },
      { name: 'Hagondange', delayMinutes: 7 },
      { name: 'Uckange', delayMinutes: 7 },
      { name: 'Thionville', delayMinutes: 7, platform: '1' },
      { name: 'Hettange-Grande', delayMinutes: 7 },
      { name: 'Bettembourg', delayMinutes: 7 },
      { name: 'Luxembourg', delayMinutes: 7, platform: '8' }
    ],
    disruptions: [{ summary: 'Exemple visuel : +7 min sur l’ensemble du parcours.' }],
    provenance: [
      { source: 'sncf-gtfs-rt', stale: false },
      { source: 'cfl-arrivals', stale: false },
      { source: 'labetaillere-composition', stale: false }
    ]
  };

  const render = () => {
    if (!window.LBTrainUI) return;
    if ($('demoCompact')) $('demoCompact').innerHTML = window.LBTrainUI.compact(train, { action: false });
    if ($('demoFavorite')) $('demoFavorite').innerHTML = window.LBTrainUI.favorite(train, { allowRemove: true });
    if ($('demoFull')) $('demoFull').innerHTML = window.LBTrainUI.full(train);
  };

  const modal = $('componentModal');
  const open = $('openComponentModal');
  const close = $('closeComponentModal');
  let previous = null;

  const openModal = () => {
    if (!modal) return;
    previous = document.activeElement;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    close?.focus();
  };
  const closeModal = () => {
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.removeProperty('overflow');
    if (previous instanceof HTMLElement) previous.focus();
  };

  open?.addEventListener('click', openModal);
  close?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal?.classList.contains('is-open')) closeModal();
  });

  render();
  document.addEventListener('lb:train-ui-ready', render, { once: true });
})();

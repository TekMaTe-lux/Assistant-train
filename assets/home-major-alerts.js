'use strict';

(function loadLabetaillereModules(){
  const head = document.head || document.documentElement;

  const load = (src, id) => {
    if (document.getElementById(id)) return;
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = false;
    head.appendChild(script);
  };

  // Script dâ€™alertes historique conservÃ© Ã  lâ€™identique.
  load('./assets/home-major-alerts-core.js?v=20260826-1', 'lb-home-major-alert-core');

  // Pont gare dynamique Luxembourg -> fiche train #BER.
  load('./assets/lux-train-sheet.js?v=20260826-1', 'lb-lux-train-sheet');

  // Signalement LIVE : toujours proposer le parcours complet, jamais seulement l'origine/destination.
  // La logique de signalement voyageur reste sÃ©parÃ©e et n'est pas modifiÃ©e ci-dessous.
  load('./assets/signal-stations-fix.js?v=20260902-1', 'lb-signal-stations-fix');

  // Pont lÃ©ger carte <-> Voix du BÃ©tail + estimation GPS Ã  la demande.
  load('./assets/lb-community-map-bridge-v1.js?v=20260905-5', 'lb-community-map-bridge-v1');

  const CANONICAL_SNAPSHOT_URL = 'https://vps.labetaillere.fr/map-v2/v4-preview/data/snapshot.json';
  const CANONICAL_REFRESH_MS = 15000;
  let canonicalSnapshot = null;
  let canonicalLoadedAt = 0;
  let canonicalPending = null;

  const normalizeTrainNumber = (value) => String(value || '').trim().replace(/^0+(?=\d)/, '');
  const normalizeStation = (value) => String(value || '')
    .normalize('NFD')
×ß}òÚ$z{-®éÜj×ŒKšœÈ‚•T‘ÑUÒ”ÏH‰TÔÑUÑT‹Û‹XÛÛ[][š]K]˜]™[\‹]ŒKšœÈ‚”ÕSTH‰
]H
ÉVI[IYIR	SITËISŠH‚PÒÕTH‰ÓÔ‘K˜˜ZËXÛÛ[][š]K]˜]™[\‹]ŒKIÕST‚‚–ÖÈYˆ‰ÓÔ‘HˆWHÈXÚÈ‘T”‘UTˆØ\H[›İ]˜X›Nˆ	ÓÔ‘Hˆ‰ŒÈ^]ÈB–ÖÈYˆ‰ÓÕTÑWÒ”ÈˆWHÈXÚÈ‘T”‘UTˆ[Ù[H[›İ]˜X›Nˆ	ÓÕTÑWÒ”Èˆ‰ŒÈ^]ÎÈB‚˜ÜXH‰ÓÔ‘Hˆ‰PÒÕT‚š[œİ[Y[HÍMH‰TÔÑUÑTˆ‚š[œİ[[H‰ÓÕTÑWÒ”Èˆ‰T‘ÑUÒ”È‚‚œ]ÛŒÈH‰ÓÔ‘Hˆ	ÔIÂ™œ›ÛH]Xˆ[\Ü]š[\ÜŞ\Â‚œ]H]
Ş\Ë˜\™İ–ÌWJB^H]œ™XYİ^
[˜ÛÙ[™ÏH]‹NŠB›X\šÙ\ˆH	ÏØÜš\YH›‹XÛÛ[][š]K]˜]™[\‹]ŒHˆÜ˜ÏH‹‹Ø\ÜÙ]ËÛ‹XÛÛ[][š]K]˜]™[\‹]ŒKšœÏİLŒŒLKLÈÜØÜš\‰Âš[\Ü™B^H™KœİXŠˆ‰ÏØÜš\YH›‹XÛÛ[][š]K]˜]™[\‹]ŒHˆÜ˜ÏH—‹Ø\ÜÙ]ËÛ‹XÛÛ[][š]K]˜]™[\‹]ŒWšœ×İV×ˆ—JÈÜØÜš\‰ËˆX\šÙ\‹ˆ^ŠBšYˆX\šÙ\ˆ›İ[ˆ^‚ˆÛÜÚ[™ÈH^›İÙ\Š
Kœ™š[™
Ø›ÙOˆŠBˆYˆÛÜÚ[™È‚ˆ˜Z\ÙHŞ\İ[Q^]
‘T”‘UTˆ˜[\ÙHØ›ÙOˆXœÙ[HHÛÜ™HŠBˆ^H^Î˜ÛÜÚ[™×H
ÈX\šÙ\ˆ
È—ˆˆ
È^ØÛÜÚ[™Î—Bœ]Üš]Wİ^
^[˜ÛÙ[™ÏH]‹NŠB”B‚™Ü™\\H	ÚYH›‹XÛÛ[][š]K]˜]™[\‹]ŒH‰È‰ÓÔ‘HˆÈXÚÈ‘T”‘UTˆ[Ù[H›Ûˆ˜XØÛÜ™0êHˆ‰ŒÈ^]ÈB™Ü™\\H	××Ó—ĞÓÓSUS’UWÕU‘ST—ÓPTÕŒW×ÉÈ‰T‘ÑUÒ”ÈˆÈXÚÈ‘T”‘UTˆ[Ù[HÛÜpêH[˜[YHˆ‰ŒÈ^]NÈB‚™XÚÈ’[œİ[][Ûˆ\›Z[°êYKˆ‚™XÚÈ”Ø]]™YØ\™Nˆ	PÒÕT‚™XÚÈÛÜ™Nˆ	
ÚLMœİ[H‰ÓÔ‘Hˆ]ÚÈ	ŞÜš[	_IÊH‚™XÚÈ“[Ù[Nˆ	
ÚLMœİ[H‰T‘ÑUÒ”Èˆ]ÚÈ	ŞÜš[	_IÊH‚™XÚÈ”™]İ\ˆ\œšpê™NˆÜ	ÉPÒÕT	È	ÉÓÔ‘IÈ‚
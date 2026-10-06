'use strict';
function ensureSchema(db) {
  const traffic = db.prepare('PRAGMA table_info(push_traffic_state)').all();
  if (traffic.length && !traffic.some(c => c.name === 'notified_episode_id')) db.exec('ALTER TABLE push_traffic_state ADD COLUMN notified_episode_id TEXT');
  if (!db.prepare('PRAGMA table_info(push_subscriptions)').all().some(c => c.name === 'settings_json')) {
    db.exec('ALTER TABLE push_subscriptions ADD COLUMN settings_json TEXT');
  }
}
function enabled(sub, kind, prefs = {}) {
  let settings = null;
  try { settings = JSON.parse(sub.settings_json || 'null'); } catch (_) {}
  if (typeof settings?.[kind] === 'boolean') return settings[kind];
  return kind === 'favorites' ? prefs.favorites !== false : [true, 1, '1'].includes(prefs.trafficSevere);
}
async function deliver(webpush, sub, payload, ttl = 120) {
  return webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},
    JSON.stringify({...payload,timestamp:Date.now(),expiresAt:Date.now()+ttl*1000}),
    {TTL:ttl,urgency:'high',timeout:10000});
}
function register(app, db, auth, webpush) {
  ensureSchema(db);
  app.post('/api/push/subscribe',auth,(req,res)=>{
    const sub=req.body?.subscription, settings=req.body?.settings;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return res.status(400).json({error:'Abonnement push invalide'});
    const json=settings && typeof settings.favorites==='boolean' && typeof settings.trafficSevere==='boolean'
      ? JSON.stringify({favorites:settings.favorites,trafficSevere:settings.trafficSevere}) : null;
    db.prepare(`INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,user_agent,last_seen_at,settings_json)
      VALUES(?,?,?,?,?,CURRENT_TIMESTAMP,?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,
      user_agent=excluded.user_agent,last_seen_at=CURRENT_TIMESTAMP,settings_json=COALESCE(excluded.settings_json,push_subscriptions.settings_json)`)
      .run(req.user.id,sub.endpoint,sub.keys.p256dh,sub.keys.auth,req.headers['user-agent']||'',json);
    res.json({ok:true});
  });
  app.post('/api/push/status',auth,(req,res)=>{
    const row=db.prepare('SELECT settings_json FROM push_subscriptions WHERE user_id=? AND endpoint=?').get(req.user.id,String(req.body?.endpoint||''));
    res.json({ok:true,registered:!!row});
  });
  app.post('/api/push/unsubscribe',auth,(req,res)=>{
    db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').run(req.user.id,String(req.body?.subscription?.endpoint||req.body?.endpoint||''));
    res.json({ok:true});
  });
  app.post('/api/push/test',auth,async(req,res)=>{
    const endpoint=req.body?.endpoint;
    const rows=endpoint
      ? db.prepare('SELECT * FROM push_subscriptions WHERE user_id=? AND endpoint=?').all(req.user.id,String(endpoint))
      : db.prepare('SELECT * FROM push_subscriptions WHERE user_id=?').all(req.user.id);
    const delay=Math.min(15,Math.max(0,Number(req.body?.delaySeconds)||0));
    if(delay && rows.length) await new Promise(resolve=>setTimeout(resolve,delay*1000));
    let sent=0,failed=0;
    for(const row of rows) {
      try {await deliver(webpush,row,{title:'🐮 La Bétaillère',body:'Test reçu : cet appareil peut être alerté même lorsque la PWA est fermée.',url:'/#compte',tag:'lb-push-test'},60);sent++;}
      catch(err){failed++;if([404,410].includes(err.statusCode))db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(row.id);}
    }
    res.json({ok:true,sent,failed});
  });
}
module.exports={register,ensureSchema,enabled,deliver};

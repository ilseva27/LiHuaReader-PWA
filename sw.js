// v1.0.4: network-first updates prevent mixing HTML and JavaScript from different releases.
// Only reader code is cached; imported books remain in local IndexedDB.
const CACHE='lihua-reader-pwa-v1.0.4';
const ASSETS=['./','./index.html','./styles.css?v=104','./app.js?v=104','./library.js?v=104','./converter.js?v=104','./manifest.webmanifest','./vendor/jszip.min.js?v=104','./icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png'];
self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(async cache=>{await Promise.allSettled(ASSETS.map(url=>cache.add(url)));}).then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('lihua-reader-pwa-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // Prefer fresh site code when online. This avoids the old cache-first update trap.
    try {
      const response=await fetch(request);
      if(response.ok)await cache.put(request,response.clone());
      return response;
    }catch(e){
      const cached=await caches.match(request);
      if(cached)return cached;
      if(request.mode==='navigate'){
        const offline=await caches.match('./index.html');if(offline)return offline;
      }
      throw e;
    }
  })());
});

var CACHE_NAME = 'snapdrop-cache-v1.043';
var path = self.location.pathname.substring(0, self.location.pathname.lastIndexOf('/'));
console.log('path: ' + path);
var urlsToCache = [
  path + '/',
  path + '/styles.css',
  path + '/scripts/network.js',
  path + '/scripts/ui.js',
  path + '/sounds/blop.mp3',
  path + '/images/favicon-96x96.png'
];

console.log('urlsToCache: ' + urlsToCache);

self.addEventListener('install', function(event) {
  // Perform install steps
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});


self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
});

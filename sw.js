// 앱 설치(PWA)용 서비스 워커.
// 네트워크 우선: 온라인이면 항상 최신 파일을 받아 업데이트가 바로 반영되고,
// 오프라인일 때만 마지막으로 받은 파일을 쓴다. 포즈 인식 모델은 CDN에서 받으므로
// 오프라인에서는 화면만 열리고 측정은 할 수 없다.
const CACHE = "femur-length-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) ?? Response.error()),
  );
});

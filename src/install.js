// 홈 화면 설치(PWA). 측정 기능과는 독립적으로 동작한다.
const installButton = document.getElementById("install");
const iosHint = document.getElementById("install-ios");

const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
// iPadOS는 데스크톱 Safari로 표시되므로 터치 지원 여부로 구분한다.
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

let deferredPrompt = null;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((error) => console.warn("서비스 워커 등록 실패", error));
}

// iOS는 설치 버튼을 띄울 수 없어 공유 메뉴로 안내한다.
iosHint.hidden = installed || !ios;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installButton.hidden = installed;
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  installButton.hidden = true;
});

installButton.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  const prompt = deferredPrompt;
  // 설치 창은 한 번만 띄울 수 있다. 취소하면 브라우저가 나중에 다시 기회를 준다.
  deferredPrompt = null;
  installButton.hidden = true;
  await prompt.prompt();
});

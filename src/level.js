// 발 안내선 아래에 휴대폰 기울기를 표시한다. 측정 기능과는 독립적으로 동작한다.
import { FOOT_TARGET_RATIO } from "./measure.js";
import { gravityFromOrientation, tiltFromGravity } from "./tilt.js";

const LEVEL_TOLERANCE = 1; // 좌우, 앞뒤 모두 이 각도 이내면 수평으로 본다.
const SMOOTHING = 0.15; // 센서 떨림으로 숫자가 흔들리지 않도록 천천히 따라간다.

const tiltEl = document.getElementById("tilt");
tiltEl.parentElement.style.setProperty("--guide-top", `${(1 - FOOT_TARGET_RATIO) * 100}%`);

let down = null;

function screenAngle() {
  return screen.orientation?.angle ?? window.orientation ?? 0;
}

function show(text, level) {
  if (tiltEl.textContent !== text) tiltEl.textContent = text;
  tiltEl.classList.toggle("level", level);
  tiltEl.hidden = false;
}

function onOrientation({ beta, gamma }) {
  // 센서가 없는 PC에서는 값이 비어 있는 이벤트가 올 수 있다.
  if (beta === null || gamma === null) return;
  const next = gravityFromOrientation(beta, gamma);
  down = down
    ? {
        x: down.x + (next.x - down.x) * SMOOTHING,
        y: down.y + (next.y - down.y) * SMOOTHING,
        z: down.z + (next.z - down.z) * SMOOTHING,
      }
    : next;

  const { roll, pitch } = tiltFromGravity(down, screenAngle());
  const side = Math.abs(Math.round(roll));
  const front = Math.abs(Math.round(pitch));
  show(`좌우 ${side}° · 앞뒤 ${front}°`, side <= LEVEL_TOLERANCE && front <= LEVEL_TOLERANCE);
}

function listen() {
  window.addEventListener("deviceorientation", onOrientation);
}

if (typeof DeviceOrientationEvent === "undefined") {
  // 기울기 센서를 지원하지 않는 환경에서는 표시하지 않는다.
} else if (typeof DeviceOrientationEvent.requestPermission === "function" && navigator.maxTouchPoints > 0) {
  // iOS는 사용자가 직접 눌러야 센서 권한을 요청할 수 있다.
  tiltEl.textContent = "탭하여 기울기 표시";
  tiltEl.hidden = false;
  tiltEl.addEventListener(
    "click",
    async () => {
      try {
        const state = await DeviceOrientationEvent.requestPermission();
        if (state === "granted") {
          tiltEl.textContent = "기울기 확인 중…";
          listen();
        } else {
          tiltEl.textContent = "기울기 권한이 거부되었습니다";
        }
      } catch (error) {
        console.warn(error);
        tiltEl.textContent = "기울기를 표시할 수 없습니다";
      }
    },
    { once: true },
  );
} else {
  listen();
}

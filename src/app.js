import {
  FOOT_TARGET_RATIO,
  analyze,
  footGapFromBottom,
  hasBody,
  hipAngle,
  isFootOnLine,
  isSideOn,
  isStanding,
  toFrame,
  updateTracking,
} from "./measure.js";

const MEDIAPIPE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";

const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const startButton = document.getElementById("start");
const finishButton = document.getElementById("finish");
const resultEl = document.getElementById("result");
const resultEmpty = document.getElementById("result-empty");
const messagesEl = document.getElementById("messages");

let landmarker = null;
const MAX_CONSECUTIVE_FAILURES = 30; // 영상 약 1초 분량
const CAMERA_ERRORS = {
  NotAllowedError: "카메라 권한을 허용한 뒤 새로고침해 주세요.",
  NotFoundError: "카메라를 찾을 수 없습니다.",
  NotReadableError: "다른 앱이 카메라를 사용 중입니다. 해당 앱을 종료하고 새로고침해 주세요.",
};

let failures = 0; // 포즈 인식이 연속으로 실패한 프레임 수
let recording = false; // 시작을 누른 뒤 완료를 누르기 전까지 true
let tracking = false; // 측정 조건을 만족해 실제로 프레임을 기록하는 동안 true
let frames = [];
let lastVideoTime = -1;

function setStatus(text, tone = "") {
  // 매 프레임 호출되므로, 문구가 그대로면 DOM과 스크린리더 안내를 건드리지 않는다.
  if (statusEl.textContent === text && statusEl.dataset.tone === tone) return;
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

function updateControls() {
  startButton.disabled = !landmarker || recording;
  finishButton.disabled = !recording;
}

async function openCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  await video.play();
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  video.parentElement.classList.add("live");
}

async function createLandmarker(delegate) {
  // 정적 import는 실패하면 앱 전체가 실행되지 않으므로, 오류를 안내할 수 있도록 동적으로 불러온다.
  const { FilesetResolver, PoseLandmarker } = await import(`${MEDIAPIPE_URL}/vision_bundle.mjs`);
  const vision = await FilesetResolver.forVisionTasks(`${MEDIAPIPE_URL}/wasm`);
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

async function loadLandmarker() {
  try {
    return await createLandmarker("GPU");
  } catch (error) {
    console.warn("GPU 초기화 실패, CPU로 전환합니다.", error);
    return createLandmarker("CPU");
  }
}

function drawSkeleton(joints) {
  const path = [joints.shoulder, joints.hip, joints.knee, joints.ankle];
  const scale = canvas.width / 1280;

  ctx.lineWidth = 6 * scale;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#35d0a5";
  ctx.beginPath();
  path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  for (const p of path) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font = `600 ${32 * scale}px system-ui, sans-serif`;
  ctx.lineWidth = 5 * scale;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
  const label = `${hipAngle(joints).toFixed(0)}°`;
  const labelX = joints.hip.x + 20 * scale;
  ctx.strokeText(label, labelX, joints.hip.y);
  ctx.fillText(label, labelX, joints.hip.y);
}

function drawGuide(lineY, onLine) {
  const scale = canvas.width / 1280;
  ctx.save();
  ctx.setLineDash([24 * scale, 14 * scale]);
  ctx.lineWidth = 4 * scale;
  ctx.strokeStyle = onLine ? "#35d0a5" : "#ffc48f";
  ctx.beginPath();
  ctx.moveTo(0, lineY);
  ctx.lineTo(canvas.width, lineY);
  ctx.stroke();
  ctx.restore();
}

/** 지금 자세의 문제를 안내 문구로 돌려준다. 문제가 없으면 null. */
function postureProblem(frame, gapRatio) {
  if (!frame) return "사람이 보이지 않습니다";
  if (!hasBody(frame)) return "전신이 화면에 나오게 해 주세요";
  if (!isSideOn(frame)) return "몸의 왼쪽이 카메라를 향하게 서 주세요";
  if (gapRatio === null) return "발이 화면에 나오게 해 주세요";
  if (!isFootOnLine(gapRatio, tracking)) {
    return gapRatio < FOOT_TARGET_RATIO
      ? "카메라에서 조금 멀어져 발을 안내선에 맞춰 주세요"
      : "카메라 쪽으로 조금 다가와 발을 안내선에 맞춰 주세요";
  }
  if (!tracking && !isStanding(frame)) return "똑바로 서 주세요";
  return null;
}

function showLiveState(frame, gapRatio) {
  const problem = postureProblem(frame, gapRatio);
  if (problem) {
    const prefix = tracking ? "측정 중 · " : recording ? "측정 대기 · " : "";
    setStatus(prefix + problem, "warn");
  } else if (tracking) {
    setStatus("측정 중 · 스쿼트를 진행한 뒤 완료를 누르세요", "live");
  } else {
    setStatus("준비 완료 · 시작을 누르세요", "ok");
  }
}

/** 기기 회전으로 영상 크기가 바뀌면 캔버스를 맞추고, 비교할 수 없게 된 기록을 버린다. */
function syncVideoSize() {
  if (video.videoWidth === canvas.width && video.videoHeight === canvas.height) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  if (recording) {
    frames = [];
    tracking = false;
    renderMessages(["화면이 회전되어 기록을 지웠습니다. 발을 안내선에 맞추고 다시 똑바로 서 주세요."]);
  }
}

function processVideoFrame() {
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  syncVideoSize();

  const result = landmarker.detectForVideo(video, performance.now());
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const landmarks = result.landmarks[0];
  const frame = landmarks ? toFrame(landmarks, video.videoWidth, video.videoHeight) : null;

  const gapRatio = frame ? footGapFromBottom(frame, video.videoHeight) : null;

  if (recording) {
    tracking = updateTracking(frame, gapRatio, tracking);
    if (tracking && frame) frames.push(frame);
  }

  drawGuide(video.videoHeight * (1 - FOOT_TARGET_RATIO), gapRatio !== null && isFootOnLine(gapRatio, tracking));
  if (frame) drawSkeleton(frame);
  showLiveState(frame, gapRatio);
  failures = 0;
}

/** 포즈 인식을 복구할 수 없을 때 끊긴 기록을 버리고 멈춘다. */
function stopWithError() {
  landmarker = null;
  recording = false;
  tracking = false;
  frames = [];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  setStatus("포즈 인식이 중단되었습니다. 새로고침해 주세요.", "warn");
  updateControls();
}

function loop() {
  try {
    processVideoFrame();
  } catch (error) {
    console.error(error);
    failures++;
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      stopWithError();
      return;
    }
  }
  requestAnimationFrame(loop);
}

function renderMessages(messages) {
  messagesEl.replaceChildren(
    ...messages.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }),
  );
}

function renderResult(analysis) {
  if (!analysis.ok) {
    resultEl.hidden = true;
    resultEmpty.hidden = true;
    renderMessages([analysis.error]);
    return;
  }
  document.getElementById("value-t").textContent = analysis.T.toFixed(2);
  document.getElementById("value-f").textContent = analysis.F.toFixed(2);
  document.getElementById("value-u").textContent = analysis.U.toFixed(2);
  document.getElementById("value-angle").textContent = analysis.angle.toFixed(1);
  resultEl.hidden = false;
  resultEmpty.hidden = true;
  renderMessages(analysis.warnings);
}

startButton.addEventListener("click", () => {
  frames = [];
  recording = true;
  resultEl.hidden = true;
  resultEmpty.hidden = false;
  renderMessages([]);
  updateControls();
});

finishButton.addEventListener("click", () => {
  recording = false;
  tracking = false;
  renderResult(analyze(frames));
  updateControls();
});

async function main() {
  updateControls();

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("이 환경에서는 카메라를 쓸 수 없습니다. localhost 또는 HTTPS로 접속해 주세요.", "warn");
    return;
  }

  try {
    setStatus("카메라를 여는 중…");
    await openCamera();
  } catch (error) {
    console.error(error);
    setStatus(CAMERA_ERRORS[error.name] ?? "카메라를 열지 못했습니다. 새로고침해 주세요.", "warn");
    return;
  }

  try {
    setStatus("포즈 인식 모델을 불러오는 중…");
    landmarker = await loadLandmarker();
  } catch (error) {
    console.error(error);
    setStatus("포즈 인식 모델을 불러오지 못했습니다. 네트워크를 확인하고 새로고침해 주세요.", "warn");
    return;
  }

  updateControls();
  loop();
}

main();

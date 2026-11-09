import {
  FilesetResolver,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { analyze, hasBody, hipAngle, isSideOn, nearSide, toFrame } from "./measure.js";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
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
let recording = false;
let frames = [];
let lastVideoTime = -1;

function setStatus(text, tone = "") {
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
}

async function createLandmarker(delegate) {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
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

function showLiveState(frame) {
  if (!frame) {
    setStatus(recording ? "측정 중 · 사람이 보이지 않습니다" : "사람이 보이지 않습니다", "warn");
    return;
  }
  const side = nearSide([frame]);
  if (!hasBody(frame[side])) {
    setStatus(recording ? "측정 중 · 전신이 화면에 나오게 해 주세요" : "전신이 화면에 나오게 해 주세요", "warn");
  } else if (!isSideOn(frame, side)) {
    setStatus(recording ? "측정 중 · 몸을 옆으로 돌려 주세요" : "몸을 카메라 옆으로 돌려 주세요", "warn");
  } else if (recording) {
    setStatus("측정 중 · 스쿼트를 진행한 뒤 완료를 누르세요", "live");
  } else {
    setStatus("준비 완료 · 시작을 누르세요", "ok");
  }
}

function processVideoFrame() {
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const result = landmarker.detectForVideo(video, performance.now());
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const landmarks = result.landmarks[0];
  const frame = landmarks ? toFrame(landmarks, video.videoWidth, video.videoHeight) : null;
  if (frame) {
    drawSkeleton(frame[nearSide([frame])]);
    if (recording) frames.push(frame);
  }
  showLiveState(frame);
}

function loop() {
  processVideoFrame();
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
    const denied = error.name === "NotAllowedError";
    setStatus(denied ? "카메라 권한을 허용한 뒤 새로고침해 주세요." : "카메라를 찾을 수 없습니다.", "warn");
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

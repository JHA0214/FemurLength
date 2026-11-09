// 포즈 랜드마크에서 T/F/U 길이와 F-U 각도를 계산하는 순수 함수 모음.
// 브라우저 API에 의존하지 않으므로 Node에서 바로 테스트할 수 있다.

// 사용자는 몸의 왼쪽이 카메라를 향하게 서고, 왼쪽 관절로만 측정한다.
const LANDMARKS = { shoulder: 11, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 };
const RIGHT_SHOULDER = 12; // 옆으로 섰는지 판단할 때만 쓴다.

// 발과 영상 하단 사이의 목표 거리(영상 높이 대비 비율). 카메라와 측정자의 거리를 맞추는 기준이다.
export const FOOT_TARGET_RATIO = 0.06;
// 측정을 시작할 때는 좁게 맞추고, 시작한 뒤에는 관절 떨림으로 끊기지 않도록 넓게 허용한다.
const FOOT_START_TOLERANCE = 0.02;
const FOOT_HOLD_TOLERANCE = 0.05;
// F-U 각도가 이 값 이상이면 선 자세로 본다. 반쯤 앉은 상태에서 측정이 시작되는 것을 막는다.
const STANDING_MIN_ANGLE = 165;

const MIN_VISIBILITY = 0.5;
const MIN_FRAMES = 10;
const SMOOTH_RADIUS = 2; // 앞뒤 2프레임(총 5프레임) 중앙값으로 튐을 제거한다.
const ANGLE_RADIUS = 1; // 최저점의 각도는 넓게 평균하면 실제보다 커지므로 좁게 잡는다.

// 선 자세로 볼 엉덩이 높이 범위: 전체 움직임 폭 중 가장 높은 10%.
const STANDING_BAND = 0.1;
// 엉덩이 이동 폭이 다리 길이(T+F)의 이 비율보다 작으면 스쿼트로 보지 않는다.
const MIN_SQUAT_TRAVEL = 0.1;
// 어깨 좌우 간격 / 몸통 길이가 이 값보다 크면 옆모습이 아니라고 판단한다.
const MAX_SIDE_RATIO = 0.4;

/** MediaPipe 정규화 랜드마크를 픽셀 좌표의 왼쪽 관절로 변환한다. */
export function toFrame(landmarks, width, height) {
  const frame = { rightShoulderX: landmarks[RIGHT_SHOULDER].x * width };
  for (const [joint, index] of Object.entries(LANDMARKS)) {
    const p = landmarks[index];
    const inView = p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
    frame[joint] = {
      x: p.x * width,
      y: p.y * height,
      visibility: inView ? (p.visibility ?? 0) : 0,
    };
  }
  return frame;
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function around(values, index, radius) {
  return values.slice(Math.max(0, index - radius), index + radius + 1);
}

/** 최댓값이 연속되는 구간의 가운데 인덱스. 평활하면 꼭대기가 평평해지기 때문이다. */
function peakCenter(values) {
  const peak = Math.max(...values);
  const first = values.indexOf(peak);
  let last = first;
  while (values[last + 1] === peak) last++;
  return (first + last) >> 1;
}

/** 엉덩관절에서 무릎(F)과 어깨(U)로 향하는 두 벡터가 이루는 각도(0~180°). */
export function hipAngle({ shoulder, hip, knee }) {
  const f = { x: knee.x - hip.x, y: knee.y - hip.y };
  const u = { x: shoulder.x - hip.x, y: shoulder.y - hip.y };
  const cross = f.x * u.y - f.y * u.x;
  const dot = f.x * u.x + f.y * u.y;
  return (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI;
}

/** 측정에 필요한 네 관절이 모두 화면 안에서 인식되었는지 확인한다. */
export function hasBody(joints) {
  return ["shoulder", "hip", "knee", "ankle"].every(
    (joint) => joints[joint].visibility >= MIN_VISIBILITY,
  );
}

/** 왼발의 가장 낮은 지점과 영상 하단 사이의 거리(영상 높이 대비 비율). 발이 인식되지 않으면 null. */
export function footGapFromBottom(frame, videoHeight) {
  const visible = [frame.heel, frame.toe].filter((p) => p.visibility >= MIN_VISIBILITY);
  if (visible.length === 0) return null;
  return (videoHeight - Math.max(...visible.map((p) => p.y))) / videoHeight;
}

/** 발이 안내선에 맞는지 판단한다. 측정 중 발이 잠깐 인식되지 않으면 맞는 것으로 유지한다. */
export function isFootOnLine(gapRatio, alreadyTracking) {
  if (gapRatio === null) return alreadyTracking;
  const tolerance = alreadyTracking ? FOOT_HOLD_TOLERANCE : FOOT_START_TOLERANCE;
  return Math.abs(gapRatio - FOOT_TARGET_RATIO) <= tolerance;
}

/** F-U 각도로 선 자세인지 판단한다. */
export function isStanding(frame) {
  return hipAngle(frame) >= STANDING_MIN_ANGLE;
}

/**
 * 이번 프레임을 측정에 쓸지 결정한다.
 * 발이 안내선에 맞고 선 자세일 때 시작하며, 시작한 뒤에는 발 위치만 확인한다.
 */
export function updateTracking(frame, gapRatio, alreadyTracking) {
  if (!isFootOnLine(gapRatio, alreadyTracking)) return false;
  return alreadyTracking || (frame !== null && hasBody(frame) && isStanding(frame));
}

/** 몸이 카메라에 대해 옆으로 서 있는지 어깨 좌우 간격으로 판단한다. */
export function isSideOn(frame) {
  const shoulderGap = Math.abs(frame.shoulder.x - frame.rightShoulderX);
  const torso = distance(frame.hip, frame.shoulder);
  return torso > 0 && shoulderGap / torso <= MAX_SIDE_RATIO;
}

/**
 * 기록된 프레임 전체를 분석한다.
 * - 길이: 선 자세 구간의 중앙값을 F = 1 기준 비율로 나타낸다.
 *   스쿼트 중에는 무릎이 벌어지면 2D 길이가 짧아지기 때문에 선 자세만 쓴다.
 * - 각도: 엉덩이가 가장 낮은 프레임 주변의 중앙값.
 * @returns {{ok:true, T:number, F:number, U:number, angle:number, frameCount:number, warnings:string[]} | {ok:false, error:string}}
 */
export function analyze(frames) {
  if (frames.length === 0) {
    return { ok: false, error: "측정된 구간이 없습니다. 발을 화면 아래 안내선에 맞추고 똑바로 선 상태에서 스쿼트를 시작해 주세요." };
  }

  const joints = frames.filter(hasBody);
  if (joints.length < MIN_FRAMES) {
    return {
      ok: false,
      error: "어깨부터 발목까지 인식된 구간이 너무 짧습니다. 몸의 왼쪽이 카메라를 향하게 하고 전신이 화면에 나오게 해서 다시 측정해 주세요.",
    };
  }

  const rawHipY = joints.map((j) => j.hip.y);
  const hipY = rawHipY.map((_, i) => median(around(rawHipY, i, SMOOTH_RADIUS)));

  // 이미지 y축은 아래로 증가하므로 y가 가장 큰 프레임이 가장 깊은 지점이다.
  const deepest = peakCenter(hipY);
  const top = Math.min(...hipY);
  const travel = hipY[deepest] - top;
  const standingLimit = top + travel * STANDING_BAND;
  const standing = joints.filter((_, i) => hipY[i] <= standingLimit);

  const standingLength = (a, b) => median(standing.map((j) => distance(j[a], j[b])));
  const pxT = standingLength("ankle", "knee");
  const pxF = standingLength("knee", "hip");
  const pxU = standingLength("hip", "shoulder");

  const warnings = [];
  if (travel < (pxT + pxF) * MIN_SQUAT_TRAVEL) {
    warnings.push("앉았다 일어나는 동작이 거의 감지되지 않았습니다. 각도 값이 부정확할 수 있습니다.");
  }
  const sideOnCount = joints.filter(isSideOn).length;
  if (sideOnCount < joints.length / 2) {
    warnings.push("몸이 카메라 정면 쪽을 향해 있습니다. 몸의 왼쪽이 카메라를 향하게 옆으로 서서 다시 측정해 주세요.");
  }

  return {
    ok: true,
    T: pxT / pxF,
    F: 1,
    U: pxU / pxF,
    angle: median(around(joints.map(hipAngle), deepest, ANGLE_RADIUS)),
    frameCount: joints.length,
    warnings,
  };
}

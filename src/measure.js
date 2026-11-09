// 포즈 랜드마크에서 T/F/U 길이와 F-U 각도를 계산하는 순수 함수 모음.
// 브라우저 API에 의존하지 않으므로 Node에서 바로 테스트할 수 있다.

const LANDMARKS = {
  left: { shoulder: 11, hip: 23, knee: 25, ankle: 27 },
  right: { shoulder: 12, hip: 24, knee: 26, ankle: 28 },
};

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

/** MediaPipe 정규화 랜드마크를 픽셀 좌표의 좌/우 관절로 변환한다. */
export function toFrame(landmarks, width, height) {
  const frame = {};
  for (const [side, indices] of Object.entries(LANDMARKS)) {
    frame[side] = {};
    for (const [joint, index] of Object.entries(indices)) {
      const p = landmarks[index];
      const inView = p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
      frame[side][joint] = {
        x: p.x * width,
        y: p.y * height,
        z: p.z,
        visibility: inView ? (p.visibility ?? 0) : 0,
      };
    }
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

/** 카메라에 더 가까운 쪽(z가 작은 쪽)을 고른다. */
export function nearSide(frames) {
  const meanZ = (side) => {
    let sum = 0;
    for (const frame of frames) {
      const { shoulder, hip, knee, ankle } = frame[side];
      sum += shoulder.z + hip.z + knee.z + ankle.z;
    }
    return sum;
  };
  return meanZ("left") <= meanZ("right") ? "left" : "right";
}

/** 몸이 카메라에 대해 옆으로 서 있는지 어깨 좌우 간격으로 판단한다. */
export function isSideOn(frame, side = nearSide([frame])) {
  const shoulderGap = Math.abs(frame.left.shoulder.x - frame.right.shoulder.x);
  const torso = distance(frame[side].hip, frame[side].shoulder);
  return torso > 0 && shoulderGap / torso <= MAX_SIDE_RATIO;
}

/**
 * 기록된 프레임 전체를 분석한다.
 * - 길이: 선 자세 구간의 중앙값을 F = 1 기준 비율로 나타낸다.
 *   스쿼트 중에는 무릎이 벌어지면 2D 길이가 짧아지기 때문에 선 자세만 쓴다.
 * - 각도: 엉덩이가 가장 낮은 프레임 주변의 중앙값.
 * @returns {{ok:true, T:number, F:number, U:number, angle:number, side:string, frameCount:number, warnings:string[]} | {ok:false, error:string}}
 */
export function analyze(frames) {
  if (frames.length === 0) {
    return { ok: false, error: "사람이 인식되지 않았습니다. 전신이 화면에 나오게 서 주세요." };
  }

  const side = nearSide(frames);
  const usable = frames.filter((frame) => hasBody(frame[side]));
  if (usable.length < MIN_FRAMES) {
    return {
      ok: false,
      error: "어깨부터 발목까지 인식된 구간이 너무 짧습니다. 전신이 화면에 나오게 하고 다시 측정해 주세요.",
    };
  }

  const joints = usable.map((frame) => frame[side]);
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
  const sideOnCount = usable.filter((frame) => isSideOn(frame, side)).length;
  if (sideOnCount < usable.length / 2) {
    warnings.push("몸이 카메라 정면 쪽을 향해 있습니다. 정확히 옆으로 서서 다시 측정해 주세요.");
  }

  return {
    ok: true,
    T: pxT / pxF,
    F: 1,
    U: pxU / pxF,
    angle: median(around(joints.map(hipAngle), deepest, ANGLE_RADIUS)),
    side,
    frameCount: usable.length,
    warnings,
  };
}

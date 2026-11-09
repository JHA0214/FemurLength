import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze, footGapFromBottom, hipAngle, isFootOnLine, toFrame, updateTracking } from "../src/measure.js";

const WIDTH = 1280;
const HEIGHT = 720;
const CM = 2; // 합성 데이터의 축척: 1cm = 2px
const LENGTHS = { T: 40, F: 45, U: 50 };

const deg = (d) => (d * Math.PI) / 180;

/** 발목을 고정한 2관절 옆모습을 만든다. 각도는 수직선 기준(도). */
function pose({ shin, thigh, torso, visibility = 0.9, rightVisibility = 0.9, footY = 680 }) {
  const ankle = { x: 640, y: 660 };
  const knee = {
    x: ankle.x + Math.sin(deg(shin)) * LENGTHS.T * CM,
    y: ankle.y - Math.cos(deg(shin)) * LENGTHS.T * CM,
  };
  const hip = {
    x: knee.x - Math.sin(deg(thigh)) * LENGTHS.F * CM,
    y: knee.y - Math.cos(deg(thigh)) * LENGTHS.F * CM,
  };
  const shoulder = {
    x: hip.x + Math.sin(deg(torso)) * LENGTHS.U * CM,
    y: hip.y - Math.cos(deg(torso)) * LENGTHS.U * CM,
  };
  const heel = { x: 620, y: footY - 4 };
  const toe = { x: 690, y: footY };
  const points = { shoulder, hip, knee, ankle, heel, toe };

  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const put = (index, p, v) => {
    landmarks[index] = { x: p.x / WIDTH, y: p.y / HEIGHT, z: 0, visibility: v };
  };
  const left = { shoulder: 11, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 };
  const right = { shoulder: 12, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 };
  for (const joint of Object.keys(points)) {
    put(left[joint], points[joint], visibility);
    put(right[joint], points[joint], rightVisibility);
  }
  return toFrame(landmarks, WIDTH, HEIGHT);
}

const STANDING = { shin: 0, thigh: 0, torso: 0 };

function squat(depth) {
  return { shin: 30 * depth, thigh: 80 * depth, torso: 40 * depth };
}

function repetition() {
  const frames = [];
  for (let i = 0; i < 20; i++) frames.push(pose(STANDING));
  for (let i = 0; i <= 30; i++) frames.push(pose(squat(i / 30)));
  for (let i = 30; i >= 0; i--) frames.push(pose(squat(i / 30)));
  for (let i = 0; i < 20; i++) frames.push(pose(STANDING));
  return frames;
}

// squat(1)에서 F-U 각도 = 180 - 대퇴 기울기 - 몸통 기울기
const DEEPEST_ANGLE = 180 - 80 - 40;

test("서 있을 때 F-U 각도는 180도이다", () => {
  assert.ok(Math.abs(hipAngle(pose(STANDING)) - 180) < 0.01);
});

test("길이와 가장 깊은 지점의 각도를 계산한다", () => {
  const result = analyze(repetition());
  assert.equal(result.ok, true);
  assert.ok(Math.abs(result.T - LENGTHS.T / LENGTHS.F) < 0.01, `T=${result.T}`);
  assert.equal(result.F, 1);
  assert.ok(Math.abs(result.U - LENGTHS.U / LENGTHS.F) < 0.01, `U=${result.U}`);
  assert.ok(Math.abs(result.angle - DEEPEST_ANGLE) < 3, `angle=${result.angle}`);
  assert.deepEqual(result.warnings, []);
});

test("각도는 최소 각도가 아니라 엉덩이가 가장 낮은 프레임에서 잰다", () => {
  const frames = repetition();
  // 일어나는 도중 엉덩이는 높지만 상체를 더 숙여 각도가 더 작아지는 구간
  for (let i = 0; i < 10; i++) frames.push(pose({ shin: 10, thigh: 40, torso: 110 }));
  for (let i = 0; i < 20; i++) frames.push(pose(STANDING));
  const result = analyze(frames);
  assert.ok(Math.abs(result.angle - DEEPEST_ANGLE) < 3, `angle=${result.angle}`);
});

test("한 프레임짜리 관절 튐에 깊은 지점이 흔들리지 않는다", () => {
  const frames = repetition();
  frames[5] = pose({ shin: 45, thigh: 120, torso: 10 });
  const result = analyze(frames);
  assert.ok(Math.abs(result.angle - DEEPEST_ANGLE) < 3, `angle=${result.angle}`);
});

test("왼쪽 관절로만 측정한다", () => {
  const rightHidden = Array.from({ length: 30 }, () => pose({ ...STANDING, rightVisibility: 0 }));
  assert.equal(analyze(rightHidden).ok, true);
  const leftHidden = Array.from({ length: 30 }, () => pose({ ...STANDING, visibility: 0 }));
  assert.equal(analyze(leftHidden).ok, false);
});

test("왼발의 가장 낮은 지점과 화면 하단의 거리를 영상 높이 비율로 잰다", () => {
  assert.ok(Math.abs(footGapFromBottom(pose(STANDING), HEIGHT) - 40 / HEIGHT) < 0.0001);
  assert.equal(footGapFromBottom(pose({ ...STANDING, visibility: 0 }), HEIGHT), null);
});

test("발이 안내선에 맞을 때 측정을 시작하고 벗어나면 멈춘다", () => {
  assert.equal(isFootOnLine(0.06, false), true);
  assert.equal(isFootOnLine(0.09, false), false); // 시작 전에는 좁은 범위만 허용
  assert.equal(isFootOnLine(0.09, true), true); // 측정 중에는 떨림을 허용
  assert.equal(isFootOnLine(0.13, true), false); // 걸어 나가면 기록 중단
});

test("발이 안내선에 맞아도 선 자세가 아니면 측정을 시작하지 않는다", () => {
  assert.equal(updateTracking(pose(STANDING), 0.06, false), true);
  assert.equal(updateTracking(pose(squat(0.5)), 0.06, false), false);
  assert.equal(updateTracking(pose(STANDING), 0.09, false), false);
  assert.equal(updateTracking(null, null, false), false);
});

test("측정이 시작되면 깊이 앉아도 끊기지 않고 발이 벗어나면 멈춘다", () => {
  assert.equal(updateTracking(pose(squat(1)), 0.06, true), true);
  assert.equal(updateTracking(pose(squat(1)), 0.13, true), false);
});

test("발이 잠깐 인식되지 않으면 측정 상태를 유지한다", () => {
  assert.equal(isFootOnLine(null, true), true);
  assert.equal(isFootOnLine(null, false), false);
});

test("스쿼트 동작이 없으면 경고한다", () => {
  const frames = Array.from({ length: 30 }, () => pose(STANDING));
  const result = analyze(frames);
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
});

test("관절이 인식되지 않으면 오류를 돌려준다", () => {
  assert.equal(analyze([]).ok, false);
  const frames = Array.from({ length: 30 }, () => pose({ ...STANDING, visibility: 0.1 }));
  assert.equal(analyze(frames).ok, false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze, hipAngle, toFrame } from "../src/measure.js";

const WIDTH = 1280;
const HEIGHT = 720;
const CM = 2; // 합성 데이터의 축척: 1cm = 2px
const LENGTHS = { T: 40, F: 45, U: 50 };

const deg = (d) => (d * Math.PI) / 180;

/** 발목을 고정한 2관절 옆모습을 만든다. 각도는 수직선 기준(도). */
function pose({ shin, thigh, torso, visibility = 0.9, nearZ = -0.1 }) {
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
  const points = { shoulder, hip, knee, ankle };

  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const put = (index, p, z, v) => {
    landmarks[index] = { x: p.x / WIDTH, y: p.y / HEIGHT, z, visibility: v };
  };
  const left = { shoulder: 11, hip: 23, knee: 25, ankle: 27 };
  const right = { shoulder: 12, hip: 24, knee: 26, ankle: 28 };
  for (const joint of Object.keys(points)) {
    put(left[joint], points[joint], nearZ, visibility);
    put(right[joint], points[joint], -nearZ, visibility);
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
  assert.ok(Math.abs(hipAngle(pose(STANDING).left) - 180) < 0.01);
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

test("카메라에 가까운 쪽 관절을 사용한다", () => {
  assert.equal(analyze(repetition()).side, "left");
  const frames = repetition().map(() => pose({ ...STANDING, nearZ: 0.1 }));
  assert.equal(analyze(frames).side, "right");
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

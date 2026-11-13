import assert from "node:assert/strict";
import { test } from "node:test";
import { gravityFromOrientation, tiltFromGravity } from "../src/tilt.js";

const tilt = (beta, gamma, screenAngle = 0) => tiltFromGravity(gravityFromOrientation(beta, gamma), screenAngle);
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.01, `${label}=${actual}, expected ${expected}`);

test("세로로 똑바로 세우면 좌우와 앞뒤 모두 0도이다", () => {
  const { roll, pitch } = tilt(90, 0);
  near(roll, 0, "roll");
  near(pitch, 0, "pitch");
});

test("위쪽이 뒤로 젖혀지면 앞뒤 기울기가 생긴다", () => {
  near(Math.abs(tilt(80, 0).pitch), 10, "pitch");
  near(Math.abs(tilt(0, 0).pitch), 90, "pitch"); // 바닥에 눕힌 상태
});

test("화면 평면 안에서 돌아가면 좌우 기울기가 생긴다", () => {
  // 세로로 세운 채 5도 돌린 상태는 기기에 따라 두 가지 값으로 보고된다.
  near(tilt(85, 90).roll, 5, "roll");
  near(tilt(95, -90).roll, 5, "roll");
  near(tilt(85, 90).pitch, 0, "pitch");
});

test("가로 화면에서는 화면 회전 각도를 보정한다", () => {
  near(tilt(0, -90, 90).roll, 0, "roll");
  near(tilt(0, 90, -90).roll, 0, "roll");
});

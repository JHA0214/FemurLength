// 휴대폰 기울기 계산. deviceorientation 이벤트의 beta, gamma로 중력 방향을 구한다.
// 브라우저 API에 의존하지 않으므로 Node에서 바로 테스트할 수 있다.
const RAD = Math.PI / 180;

/**
 * 기기 좌표계에서 아래(중력) 방향 단위 벡터.
 * x는 화면 오른쪽, y는 화면 위쪽, z는 화면 바깥(사용자 쪽)이다.
 */
export function gravityFromOrientation(beta, gamma) {
  const b = beta * RAD;
  const g = gamma * RAD;
  return { x: Math.cos(b) * Math.sin(g), y: -Math.sin(b), z: -Math.cos(b) * Math.cos(g) };
}

function normalizeAngle(degrees) {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/**
 * 화면 기준 기울기(도).
 * - roll: 화면 평면 안에서 돌아간 각도. 0이면 화면 아래쪽이 정확히 아래를 향한다.
 * - pitch: 화면이 수직에서 앞뒤로 기운 각도. 0이면 카메라가 수평을 바라본다.
 * screenAngle은 화면 회전 각도(screen.orientation.angle)로, 가로 화면을 보정한다.
 */
export function tiltFromGravity(down, screenAngle = 0) {
  const length = Math.hypot(down.x, down.y, down.z) || 1;
  const roll = normalizeAngle(Math.atan2(down.x, -down.y) / RAD + screenAngle);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -down.z / length))) / RAD;
  return { roll, pitch };
}

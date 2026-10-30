// 手に持たせる物（ボール、銃）。手首の座標（指先へ -Y、手のひらは左手 -X・右手 +X、親指側 +Z）で置き、寸法は fig.b.hand 倍
import * as THREE from 'three';
import { gradient, outlineMaterial } from './figure.js';

const OUTLINE = outlineMaterial();
const toon = (color) => new THREE.MeshToonMaterial({ color, gradientMap: gradient });
const BALL = toon(0xb4b4b4), GUN = toon(0x454545);
const SPHERE = new THREE.SphereGeometry(1, 32, 20);
const CUBE = new THREE.BoxGeometry(1, 1, 1);

// [形, 材質, 位置, 大きさ, X 軸まわりの傾き（度）]。位置の x は手のひらの側を負にした左手の値
const PARTS = {
  ball: [[SPHERE, BALL, [-0.05, -0.078, 0.002], [0.04, 0.04, 0.04]]],
  gun: [
    [CUBE, GUN, [-0.029, -0.068, -0.018], [0.026, 0.032, 0.11], -12], // 握り
    [CUBE, GUN, [-0.029, -0.108, 0.054], [0.024, 0.19, 0.034]], // 銃身（スライド）
    [CUBE, GUN, [-0.029, -0.112, 0.022], [0.012, 0.05, 0.03]], // 引き金の囲い
  ],
};
export const HELD = Object.keys(PARTS);

/** 手首 side の下に kind の物を作る。返す Group を手首の Group に add する */
export function makeHeld(kind, side, k) {
  const s = side === 'left' ? 1 : -1;
  const g = new THREE.Group();
  for (const [geo, mat, [x, y, z], size, tilt = 0] of PARTS[kind]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(s * x * k, y * k, z * k);
    m.scale.set(...size.map((v) => v * k));
    m.rotation.x = tilt * Math.PI / 180;
    m.castShadow = true;
    const o = new THREE.Mesh(geo, OUTLINE);
    o.raycast = () => {};
    m.add(o);
    g.add(m);
  }
  return g;
}

// 手の形状と指の関節。wrist の Group の下に手のひらと指を作る。
// 手首から指先へ -Y、手のひらは体の内側（左手 -X、右手 +X）、親指側が +Z。寸法は fig.b.hand 倍。
import * as THREE from 'three';
import { SPHERE } from './figure.js';

const D2R = Math.PI / 180;

export const FINGERS = ['index', 'middle', 'ring', 'pinky'];
// 付け根の位置 [y, z]、節の長さ、太さ。親指の 1 節目は手のひらに埋まる中手骨
export const DIMS = {
  index: { at: [-0.087, 0.026], len: [0.040, 0.025, 0.019], r: 0.0086 },
  middle: { at: [-0.091, 0.0085], len: [0.045, 0.028, 0.021], r: 0.009 },
  ring: { at: [-0.089, -0.0095], len: [0.042, 0.026, 0.020], r: 0.0085 },
  pinky: { at: [-0.082, -0.026], len: [0.032, 0.021, 0.017], r: 0.0076 },
  thumb: { at: [-0.018, 0.022], len: [0.040, 0.031, 0.026], r: 0.0095 },
};

const jname = (n, f, i) => `${n}${f[0].toUpperCase()}${f.slice(1)}${i}`;

// 角を丸めた板。手首側を少し細くする
function palmGeometry() {
  const g = new THREE.SphereGeometry(1, 48, 32);
  const p = g.attributes.position;
  const ex = [0.8, 0.45, 0.5];
  for (let i = 0; i < p.count; i++) {
    const v = [0, 1, 2].map((a) => Math.sign(p.getComponent(i, a)) * Math.abs(p.getComponent(i, a)) ** ex[a]);
    v[2] *= 0.9 - 0.1 * v[1];
    p.setXYZ(i, ...v);
  }
  g.computeVertexNormals();
  return g;
}

export function buildHand(fig, wr, s, n) {
  const k = fig.b.hand;
  const wrist = `${n}Wrist`;
  fig.mesh(palmGeometry(), wr, [s * 0.001 * k, -0.047 * k, 0], [0.014 * k, 0.046 * k, 0.041 * k]);
  for (const f of [...FINGERS, 'thumb']) {
    const { at, len, r } = DIMS[f];
    let g = wr;
    len.forEach((l, i) => {
      const pos = i ? [0, -len[i - 1] * k, 0] : [(f === 'thumb' ? -0.004 : 0.002) * s * k, at[0] * k, at[1] * k];
      g = fig.joint(jname(n, f, i + 1), g, pos);
      if (f === 'thumb' && i === 0) {
        g.rotation.order = 'YXZ';
        fig.mesh(SPHERE, g, [0, -0.021 * k, 0], [0.013 * k, 0.027 * k, 0.014 * k], wrist);
        return;
      }
      const ri = r * k * (1 - 0.07 * i);
      fig.mesh(new THREE.CapsuleGeometry(ri, l * k, 4, 12), g, [0, -l * k / 2, 0], [1, 1, 1], wrist);
    });
  }
  poseHand(fig, n, OPEN);
}

// 指の角度（度）。指は [付け根, 第 2, 第 1 関節の曲げ, 親指側へ開く]、
// 親指は [人差し指から離す, 手のひらの前へ回す, 付け根・中・先の曲げ]
export const OPEN = {
  thumb: [50, 10, 0, 0, 0],
  index: [0, 0, 0, 9], middle: [0, 0, 0, 2], ring: [0, 0, 0, -5], pinky: [0, 0, 0, -12],
};

export function poseHand(fig, n, P) {
  const s = n === 'left' ? 1 : -1;
  const curl = (g, a) => g.rotation.set(0, 0, -s * a * D2R);
  for (const f of FINGERS) {
    const [a, b, c, spread = 0] = P[f];
    fig.j[jname(n, f, 1)].rotation.set(-spread * D2R, 0, -s * a * D2R);
    curl(fig.j[jname(n, f, 2)], b);
    curl(fig.j[jname(n, f, 3)], c);
  }
  const [abd, opp, f1, f2, f3] = P.thumb;
  fig.j[jname(n, 'thumb', 1)].rotation.set(-abd * D2R, -s * opp * D2R, -s * f1 * D2R);
  curl(fig.j[jname(n, 'thumb', 2)], f2);
  curl(fig.j[jname(n, 'thumb', 3)], f3);
}

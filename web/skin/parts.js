// 皮膚の材料: 人形の体型 fig.b から、静止形での部位（距離場）と滑らかに結合する部位の組、脂肪、格子を作る。
// 静止形は root の座標（体の縮尺を掛ける前）。腕は横へ 65°、脚は 5° 開き、手は OPEN（指を開いた形）。
// 体の中身（骨・筋・脂肪）は anatomy.js、手は hands.js の寸法から作る。
import * as THREE from 'three';
import { BODY, Figure, SPHERE } from '../figure.js';
import { DIMS, FINGERS } from '../hands.js';
import { anatomy } from './anatomy.js';

export const REST = { leftShoulder: [0, 58, 0], rightShoulder: [0, 58, 0], leftHip: [0, 5, 0], rightHip: [0, 5, 0] };
export const CELL = { body: 0.007, hand: 0.002, anatomy: 0.008 };

const rows = (m) => { const e = m.elements; return [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]]; };
const cap = (f) => f[0].toUpperCase() + f.slice(1);

// 違う grp どうしを結合する規則: [grp a, grp b, k, 関節, その関節からの範囲]。左右は L/R を差し替えて両方に使う
const RULES = [
  ['head', 'neck', 0.016, 'head', 0.1],
  ['neck', 'trunk', 0.02, 'neck', 0.12],
  ['trunk', 'S.arm', 0.026, 'Shoulder', 0.14],
  ['neck', 'S.arm', 0.012, 'Shoulder', 0.08],
  ['S.arm', 'S.fore', 0.024, 'Elbow', 0.09],
  ['trunk', 'S.thigh', 0.034, 'Hip', 0.16],
  ['trunk', 'S.glute', 0.04, null, 0],
  ['S.glute', 'S.thigh', 0.022, 'Hip', 0.2],
  ['S.thigh', 'S.shin', 0.03, 'Knee', 0.1],
  ['S.shin', 'S.foot', 0.022, 'Ankle', 0.08],
];

// 静止形での各関節の行列（root の座標）
export function restFrames(who, b) {
  const f = new Figure(who, b);
  // 静止形の肩甲帯は中立（リズムを切る。腕の 58° 開きで鎖骨・肩甲骨が動かない）
  f.rhythm = false;
  for (const [n, v] of Object.entries(REST)) f.setJoint(n, v);
  f.root.position.set(0, 0, 0);
  f.root.updateMatrixWorld(true);
  const inv = f.root.matrixWorld.clone().invert();
  const frames = Object.fromEntries(Object.entries(f.j).map(([n, g]) => [n, inv.clone().multiply(g.matrixWorld)]));
  for (const m of f.meshes) if (m.geometry !== SPHERE) m.geometry.dispose();
  f.mat.dispose();
  return frames;
}

// 部位の座標での範囲
function extent(kind, p) {
  if (kind === 'ell' || kind === 'palm') return [[-p[0], -p[1], -p[2]], [p[0], p[1], p[2]]];
  const r = Math.max(p[1], p[2]), rz = r * Math.max(1, p[3] ?? 1);
  return [[-r, -p[0] - p[2], -rz], [r, p[1], rz]];
}

function boxOf(F, ext) {
  const box = new THREE.Box3();
  for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) box.expandByPoint(new THREE.Vector3(ext[x][0], ext[y][1], ext[z][2]).applyMatrix4(F));
  return [...box.min.toArray(), ...box.max.toArray()];
}

// 胴の骨の並び。胴の中央の部位（腹直筋・腹斜筋・脊柱起立筋も）はこの関節の高さで骨を移す
const TRUNK = ['hips', 'spine', 'chest'];
// 胴の骨を移す範囲（子の関節の高さからの [下, 上]、m）。腰椎は仙骨の上から曲がるように下へ広く取る
const AXIAL_BAND = { spine: [-0.1, 0.06], chest: [-0.06, 0.06] };

export function buildSpec(who, b) {
  const frames = restFrames(who, b);
  const bones = Object.keys(frames);
  const boneOf = Object.fromEntries(bones.map((n, i) => [n, i]));
  const parts = [], name = {}, edges = [];
  const V = (...a) => new THREE.Vector3(...a);
  const BODY_ONLY = { body: null };
  const pivot = (j) => V().setFromMatrixPosition(frames[j]);

  // F: 部位の座標 → 静止形。o: { layer, grp, side, joint, chain, k, girdle }
  function put(id, kind, F, p, o, mesh = BODY_ONLY) {
    const m = rows(F.clone().invert());
    name[id] = parts.length;
    const hand = Object.keys(mesh).some((k) => k !== 'body');
    const pt = { id, kind, m, p, bone: boneOf[o.joint], box: boxOf(F, extent(kind, p)), mesh, hand, layer: o.layer, grp: o.grp, side: o.side ?? 0, k: o.k ?? 0.012 };
    if (o.girdle) pt.girdle = o.girdle;
    // 胴と首の骨は柔らかい柱の中にあるので固定しない。手足の骨と頭は骨に固く付ける
    pt.rigid = o.layer === 'bone' && !/^(trunk|neck)$/.test(o.grp) && !o.soft;
    // 筋の軸に沿った u（0 が起始）と、関節の位置で骨を移す節。
    // 軸が関節の並びと交わる向き（首の付け根から肩先へ横に張る筋など）は、軸に沿って骨を移すと横の端ごと別の骨に付くので使わない
    let chain = o.chain;
    const Y = V(0, 1, 0).transformDirection(F);
    if (chain && chain.length > 1 && !o.full) {
      const run = pivot(chain.at(-1)).sub(pivot(chain[0])).normalize();
      if (Math.abs(Y.dot(run)) < 0.5) chain = null;
    }
    // 胴の中央の部位（肩甲帯を除く）は、形の軸でなく背骨の高さで 腰 → 背 → 胸 と移る
    const axial = o.grp === 'trunk' && !o.girdle && (!chain || chain.every((j) => TRUNK.includes(j)));
    if (axial) chain = TRUNK;
    if (chain && chain.length > 1) {
      const ax = axial ? null : kind === 'ell' ? [1 / (2 * p[1]), 0.5] : [-1 / p[0], 0];
      const inv = F.clone().invert();
      const uOf = (j) => (axial ? pivot(j).y : ax[0] * pivot(j).applyMatrix4(inv).y + ax[1]);
      const sp = 0.035 * Math.abs(ax?.[0] ?? 0);
      // 骨は関節の位置で親から子へ移る。形の軸が子から親へ向いている（上から下へ描いた背骨・首の筋など）ときは u の向きを逆に読む
      const dir = uOf(chain.at(-1)) >= uOf(chain[0]) ? 1 : -1;
      const knots = [];
      for (let i = 1; i < chain.length; i++) {
        const u = uOf(chain[i]);
        const [lo, hi] = axial ? AXIAL_BAND[chain[i]] : [-sp, sp];
        knots.push([u + dir * lo, boneOf[chain[i - 1]]], [u + dir * hi, boneOf[chain[i]]]);
      }
      knots.sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < knots.length; i++) knots[i][0] = Math.max(knots[i][0], knots[i - 1][0] + 1e-4);
      // full = [u0, u1]: 関節の位置によらず、軸の u0 から u1 の間で起始の骨から停止の骨へ移す（肩と腋を覆う筋。腕を下ろしたとき折れ目が棚にならない）
      if (o.full && !axial) knots.splice(0, knots.length, [o.full[0], boneOf[chain[0]]], [o.full[1], boneOf[chain.at(-1)]]);
      if (axial) pt.axw = [0, 1, 0, 0];
      else pt.ax = ax;
      pt.knots = knots;
    }
    parts.push(pt);
  }
  const at = (joint, offset) => frames[joint].clone().multiply(new THREE.Matrix4().makeTranslation(...offset));
  // a, b: 部位名。joint: 結合を限る関節（null は全体）、fall: その半径
  function edge(a, b2, k, wr, joint = null, fall = 0) {
    const j = joint ? pivot(joint) : V();
    edges.push([name[a], name[b2], k, wr, j.x, j.y, j.z, joint ? fall : 0]);
  }

  const { prims, fat } = anatomy(who, b, frames, BODY[who]);
  for (const q of prims) put(q.id, q.kind, q.F, q.p, q);

  // 前腕の芯: 手首の太さ。体と手の両方にあり、手首から 3cm の所で接して入れ替わり、それぞれの端は相手の内側で閉じる
  const k = b.hand;
  for (const [s, n] of [[1, 'left'], [-1, 'right']]) {
    const N = n === 'left' ? 'L' : 'R';
    const J = (x) => `${n}${x}`;
    const el = frames[J('Elbow')];
    const A = V(0, -0.03, 0).applyMatrix4(el), Bw = V(0, -b.fa, 0).applyMatrix4(el);
    const Y = A.clone().sub(Bw).normalize(), Z = V(0, 0, 1).transformDirection(el);
    const X = new THREE.Vector3().crossVectors(Y, Z);
    const F = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(A);
    const rw = 0.021 * k * (b.r.fa[1] / BODY[who].r.fa[1]) ** 0.5;
    put(`forearm.${N}`, 'cone', F, [A.distanceTo(Bw), rw * 1.12, rw, 1.35],
      { layer: 'muscle', grp: `${N}.fore`, side: s, joint: J('Elbow'), k: 0.014 },
      { body: [1, 0.03, 0.006, 0.005], [n]: [-1, 0.03, 0.002, 0.05] });

    const H = { [n]: null };
    const hand = (id, kind, F2, p, joint, kk = 0.008) => put(id, kind, F2, p, { layer: 'muscle', grp: `${N}.hand`, side: s, joint, k: kk }, H);
    hand(J('palm'), 'palm', at(J('Wrist'), [s * 0.001 * k, -0.047 * k, 0]), [0.014 * k, 0.046 * k, 0.041 * k, 0.012 * k], J('Wrist'));
    // 手のひらの小指側のふくらみと、手首の尺骨頭・橈骨の茎状突起
    hand(J('hypothenar'), 'ell', at(J('Wrist'), [-s * 0.006 * k, -0.045 * k, -0.027 * k]), [0.01 * k, 0.03 * k, 0.012 * k], J('Wrist'));
    hand(J('ulnaHead'), 'ell', at(J('Elbow'), [s * 0.004 * k, -b.fa + 0.012, -0.022 * k]), [0.01 * k, 0.011 * k, 0.009 * k], J('Elbow'), 0.006);
    hand(J('radiusStyloid'), 'ell', at(J('Elbow'), [0, -b.fa + 0.01, 0.024 * k]), [0.012 * k, 0.012 * k, 0.008 * k], J('Elbow'), 0.006);
    edge(`forearm.${N}`, J('palm'), 0.012, 0.02);
    edge(`forearm.${N}`, J('hypothenar'), 0.008, 0.02);
    edge(J('palm'), J('hypothenar'), 0.008, 0.012);
    for (const x of ['ulnaHead', 'radiusStyloid']) { edge(`forearm.${N}`, J(x), 0.006, 0.01); edge(J('palm'), J(x), 0.008, 0.012); }
    for (const f of [...FINGERS, 'thumb']) {
      const { len, r } = DIMS[f];
      const seg = (i) => `${n}${cap(f)}${i}`;
      len.forEach((l, i) => {
        if (f === 'thumb' && i === 0) hand(seg(1), 'ell', at(seg(1), [0, -0.021 * k, 0]), [0.013 * k, 0.027 * k, 0.014 * k], seg(1));
        else { const ri = r * k * (1 - 0.07 * i); hand(seg(i + 1), 'cone', at(seg(i + 1), [0, 0, 0]), [l * k, ri, ri], seg(i + 1)); }
      });
      edge(J('palm'), seg(1), f === 'thumb' ? 0.01 : 0.006, f === 'thumb' ? 0.015 : 0.012);
      edge(seg(1), seg(2), 0.004, 0.008);
      edge(seg(2), seg(3), 0.003, 0.007);
    }
    edge(J('hypothenar'), `${n}Pinky1`, 0.004, 0.008);
  }

  // 体の部位どうしの結合: 同じ grp は左右反対を除いて、違う grp は RULES のものだけ。範囲が重ならない組は除く
  const rules = new Map();
  for (const [a, b2, kk, j, fall] of RULES) {
    for (const [S, n] of [['L', 'left'], ['R', 'right']]) {
      const ga = a.replace('S.', `${S}.`), gb = b2.replace('S.', `${S}.`);
      rules.set(`${ga}|${gb}`, [kk, j ? (j === 'head' ? 'head' : j === 'neck' ? 'neck' : `${n}${j}`) : null, fall]);
    }
  }
  const near = (p, q, m) => p.box[0] - m <= q.box[3] && q.box[0] - m <= p.box[3] && p.box[1] - m <= q.box[4] && q.box[1] - m <= p.box[4] && p.box[2] - m <= q.box[5] && q.box[2] - m <= p.box[5];
  const body = parts.filter((p) => !p.grp.endsWith('.hand'));
  for (let i = 0; i < body.length; i++) for (let j2 = i + 1; j2 < body.length; j2++) {
    const p = body[i], q = body[j2];
    let kk, joint = null, fall = 0;
    if (p.grp === q.grp) {
      if (p.side * q.side < 0) continue;
      // 骨と筋の境は筋の幅の半分でならす（骨の小さい幅のままだと境に溝ができる）
      kk = p.layer === q.layer ? Math.min(p.k, q.k) : Math.max(Math.min(p.k, q.k), 0.5 * Math.max(p.k, q.k));
    } else {
      const r = rules.get(`${p.grp}|${q.grp}`) ?? rules.get(`${q.grp}|${p.grp}`);
      if (!r) continue;
      [kk, joint, fall] = r;
      kk = Math.min(kk, Math.max(p.k, q.k));
    }
    if (!near(p, q, kk)) continue;
    edge(p.id, q.id, kk, Math.max(0.015, kk), joint, fall);
  }

  // 脂肪の領域を距離場の形に
  const fatSpec = {
    base: fat.base,
    holes: fat.holes,
    regions: fat.regions.map((r) => ({ m: rows(r.F.clone().invert()), r: r.R, t: r.t, box: boxOf(r.F, [r.R.map((x) => -x), r.R]) })),
  };

  // 格子: 体は root の座標、手は手首の座標（指の向きにそろえる）。脂肪で外へ出る分を足す
  const bodyBox = new THREE.Box3();
  for (const p of parts) if ('body' in p.mesh) bodyBox.union(new THREE.Box3(V(...p.box.slice(0, 3)), V(...p.box.slice(3))));
  bodyBox.expandByScalar(0.03 + fat.base + Math.max(0, ...fatSpec.regions.map((r) => r.t)));
  // 脂肪・筋が多い体は面が広がり部位も重なるので、格子を少し粗くして組み上がりの時間をそろえる
  const coarse = Math.min(1.15, 1 + 0.07 * Math.max(0, (b.fat ?? 1) - 1) + 0.08 * Math.max(0, (b.muscle ?? 1) - 1));
  const grids = { body: gridOver(bodyBox, CELL.body * coarse, null), anatomy: gridOver(bodyBox, CELL.anatomy, null) };
  for (const n of ['left', 'right']) {
    const G = frames[`${n}Wrist`];
    const toG = G.clone().invert();
    const box = new THREE.Box3();
    for (const p of parts) {
      if (!(n in p.mesh)) continue;
      for (const x of [0, 3]) for (const y of [1, 4]) for (const z of [2, 5]) box.expandByPoint(V(p.box[x], p.box[y], p.box[z]).applyMatrix4(toG));
    }
    box.max.y = Math.min(box.max.y, 0.05);
    grids[n] = gridOver(box, CELL.hand, rows(G));
  }
  return { bones, frames, parts, edges, grids, fat: fatSpec };
}

function gridOver(box, cell, g) {
  const pad = cell * 3;
  const min = box.min.toArray().map((x) => x - pad);
  const n = box.max.toArray().map((x, i) => Math.ceil((x + pad - min[i]) / cell) + 1);
  return { min, n, cell, g };
}

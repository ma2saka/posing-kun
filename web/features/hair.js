// 髪: 頭頂から垂れる房を横に並べてつないだ 1 枚の面。顔の向きが見てわかる程度の簡単な形。
//   頭皮の上の点は頭に固定し、その先は毎フレーム 重力 → 元の形へ戻す → 房の長さ → 隣の房との間隔 → 体の外へ押し出す を繰り返して置く。
//   座標は頭の関節のローカル（体の倍率の前、+Z が顔、Y が上）。女性はあごまでのボブと眉の上の前髪、男性は生え際までの短髪。
//   頭の形は人形の頭（doll.js の頭蓋・顔・あご）から作る方向ごとの半径の表。髪を植える頭皮と頭の当たりの両方に使う。
const D2R = Math.PI / 180;
const COLS = 56, ROWS = 20, SCALP_ROWS = 9;
// 静止形で隣の房とこれより離れた段はつながない（長い横髪と短い前髪の間の面が顔の前に張る）
const GAP = 0.03;
import { dollSegments } from '../doll.js';
import { partDist } from '../skin/sdf.js';

// 頭の形の中心
const C = [0, 0.11, -0.005];
// 髪の厚み（頭皮から浮かせる量）
const THICK = 0.005;

// 方位 phi（0 が後ろ、±180 が顔）の f = |phi|/180 → 生え際の極角 θ（頭頂から、度）。end は毛先の高さ（頭のローカル y）、tail は短髪の毛先の長さ
const STYLE = {
  female: {
    color: 0x4a3d36,
    hairline: (f) => 112 - 14 * ss(0.3, 0.6, f) - 42 * ss(0.62, 0.9, f),
    // ボブ: 後ろと横はあごの高さまで、顔の横は少し短く、前髪は眉の上まで
    end: (f) => -0.005 + 0.02 * ss(0.55, 0.75, f) + 0.09 * ss(0.78, 0.92, f),
    // 元の形へ戻す強さ（生え際, 毛先）
    stiff: [0.22, 0.04],
    puff: 0.012,
  },
  male: {
    color: 0x2f2f30,
    // 横は耳の上（毛先が耳に当たって横へ跳ねない高さ）
    hairline: (f) => 110 - 20 * ss(0.15, 0.45, f) - 28 * ss(0.62, 0.9, f),
    tail: 0.012,
    stiff: [0.75, 0.5],
  },
};
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const dirOf = (thDeg, phiDeg) => {
  const a = thDeg * D2R, p = phiDeg * D2R;
  return [Math.sin(a) * Math.sin(p), Math.cos(a), -Math.sin(a) * Math.cos(p)];
};

// 頭の形: C から見た方向ごとの、人形の頭の表面までの半径。極角 NT × 方位 NP の表
const NT = 24, NP = 48;
function headShape(fig) {
  // 人形の頭の部品（最初の頭の部品が頭蓋・後頭部・顔・あご。鼻と耳は除く）。滑らかな結合の分だけ少し外へ
  const parts = dollSegments(fig).segs.find((sg) => sg.joint === 'head').parts;
  const inside = (x, y, z) => Math.min(...parts.map((pt) => partDist(pt, x, y, z))) - 0.004 < 0;
  const r = new Float32Array(NT * NP);
  for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) {
    const d = dirOf(((t + 0.5) * 180) / NT, -180 + ((p + 0.5) * 360) / NP);
    let lo = 0, hi = 0.2;
    for (let i = 0; i < 18; i++) {
      const m = (lo + hi) / 2;
      if (inside(C[0] + d[0] * m, C[1] + d[1] * m, C[2] + d[2] * m)) lo = m; else hi = m;
    }
    r[t * NP + p] = lo;
  }
  return r;
}
// 方向（単位ベクトル、頭のローカル）の半径。升目の中心の間で双一次に補間
function radius(R, x, y, z) {
  const ft = (Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI) * NT - 0.5;
  const fp = ((Math.atan2(x, -z) / D2R + 180) / 360) * NP - 0.5;
  const t0 = Math.max(0, Math.min(NT - 1, Math.floor(ft))), t1 = Math.min(NT - 1, t0 + 1), a = Math.max(0, Math.min(1, ft - t0));
  const p0 = ((Math.floor(fp) % NP) + NP) % NP, p1 = (p0 + 1) % NP, b = fp - Math.floor(fp);
  const v = (t, p) => R[t * NP + p];
  return (1 - a) * ((1 - b) * v(t0, p0) + b * v(t0, p1)) + a * ((1 - b) * v(t1, p0) + b * v(t1, p1));
}

// 静止形の房: 頭頂 → 生え際（頭皮の上）→ 下へ垂れる部分（短髪は頭の丸みに沿って少し）。SCALP_ROWS までの点は頭に固定
function restStrands(style, R, THREE) {
  const cols = [];
  const onScalp = (th, phi) => {
    const d = dirOf(th, phi), l = radius(R, ...d) + THICK;
    return new THREE.Vector3(C[0] + d[0] * l, C[1] + d[1] * l, C[2] + d[2] * l);
  };
  for (let c = 0; c < COLS; c++) {
    const phi = -180 + (360 * (c + 0.5)) / COLS;
    const f = Math.abs(phi) / 180;
    const th = style.hairline(f);
    // 頭皮の上の点の数は全部の房でそろえる（同じ段が隣の房と同じ高さになり、面でつなげる）
    const pts = [];
    for (let i = 0; i <= SCALP_ROWS; i++) pts.push(onScalp((th * i) / SCALP_ROWS, phi));
    const hl = pts[SCALP_ROWS];
    const n = ROWS - 1 - SCALP_ROWS;
    if (style.end) {
      const L = Math.max(0.01, hl.y - style.end(f));
      const out = hl.clone().sub(new THREE.Vector3(...C)).setY(0).normalize();
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        pts.push(hl.clone().addScaledVector(out, style.puff * Math.sin(t * Math.PI * 0.8)).add(new THREE.Vector3(0, -L * t, 0)));
      }
    } else {
      for (let i = 1; i <= n; i++) pts.push(onScalp(th + ((i / n) * style.tail) / 0.1 / D2R, phi));
    }
    cols.push(pts);
  }
  return cols;
}

// 頭以外の体の当たり: 胸の楕円体、首・鎖骨・上腕の円柱（ワールド座標、半径に余白）
function bodyColliders(fig, THREE) {
  const s = fig.b.scale, b = fig.b, j = fig.j, m = 0.008 * s;
  const W = (o, x = 0, y = 0, z = 0) => o.localToWorld(new THREE.Vector3(x, y, z));
  const M = new THREE.Matrix4().compose(W(j.chest, 0, 0.12, 0), j.chest.getWorldQuaternion(new THREE.Quaternion()), new THREE.Vector3(...b.chest).multiplyScalar(1.08 * s).addScalar(m));
  return {
    ell: [{ M, I: M.clone().invert() }],
    cap: [
      [W(j.neck, 0, -0.02, 0), W(j.neck, 0, 0.08, 0), b.r.neck * 1.3 * s + m],
      [W(j.leftClavicle), W(j.leftShoulder), 0.03 * s + m],
      [W(j.rightClavicle), W(j.rightShoulder), 0.03 * s + m],
      [W(j.leftShoulder), W(j.leftElbow), b.r.ua[0] * 1.25 * s + m],
      [W(j.rightShoulder), W(j.rightElbow), b.r.ua[0] * 1.25 * s + m],
    ],
  };
}

export default function init(ctx) {
  const { THREE, figs } = ctx;
  const KEY = 'posing-kun.hair';
  let on = true;
  try { on = localStorage.getItem(KEY) !== '0'; } catch { /* 既定は表示 */ }
  const ITER = 10;
  const q = new THREE.Vector3(), d = new THREE.Vector3();

  const hairs = new Map();
  function build(fig) {
    const style = STYLE[fig.who] ?? STYLE.female;
    const R = headShape(fig);
    const cols = restStrands(style, R, THREE);
    const across = cols.map((pts, c) => pts.map((p, i) => p.distanceTo(cols[(c + 1) % COLS][i])));
    const joined = across.map((row) => row.map((x) => x < GAP));
    const idx = [];
    for (let c = 0; c < COLS; c++) {
      const c2 = (c + 1) % COLS;
      for (let i = 0; i < ROWS - 1; i++) {
        if (!joined[c][i] || !joined[c][i + 1]) continue;
        const a = c * ROWS + i, b = c2 * ROWS + i;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const old = hairs.get(fig);
    if (old) { old.mesh.removeFromParent(); old.mesh.geometry.dispose(); old.mesh.material.dispose(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COLS * ROWS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, new THREE.MeshToonMaterial({ color: style.color, side: THREE.DoubleSide }));
    mesh.name = 'hair';
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    const seg = cols.map((pts) => pts.map((p, i) => (i ? p.distanceTo(pts[i - 1]) : 0)));
    const h = { style, R, cols, seg, across, joined, mesh, P: null };
    hairs.set(fig, h);
    return h;
  }

  // 頭の形の外へ（頭のローカルで方向ごとの半径＋髪の厚み）、体の当たりの外へ、床の上へ。相手の頭と体も含む
  function pushOut(p, heads, body) {
    for (const { R, HM, HI } of heads) {
      q.copy(p).applyMatrix4(HI).sub(d.fromArray(C));
      const l = q.length();
      if (l > 1e-6) {
        const r = radius(R, q.x / l, q.y / l, q.z / l) + THICK;
        if (l < r) p.copy(q.multiplyScalar(r / l).add(d)).applyMatrix4(HM);
      }
    }
    for (const e of body.ell) {
      q.copy(p).applyMatrix4(e.I);
      const k = q.length();
      if (k < 1 && k > 1e-6) p.copy(q.multiplyScalar(1 / k).applyMatrix4(e.M));
    }
    for (const [a, b, r] of body.cap) {
      d.subVectors(b, a);
      const t = Math.min(1, Math.max(0, q.subVectors(p, a).dot(d) / d.lengthSq()));
      q.copy(a).addScaledVector(d, t);
      d.subVectors(p, q);
      const k = d.length();
      if (k < r && k > 1e-6) p.copy(q).addScaledVector(d, r / k);
    }
    p.y = Math.max(p.y, 0.004);
  }

  function step(fig, h) {
    const s = fig.b.scale;
    for (const f of Object.values(figs)) f.root.updateMatrixWorld(true);
    const HM = fig.j.head.matrixWorld;
    const others = Object.values(figs).filter((f) => f !== fig && f.root.visible && hairs.has(f));
    const heads = [fig, ...others].map((f) => ({ R: hairs.get(f).R, HM: f.j.head.matrixWorld, HI: f.j.head.matrixWorld.clone().invert() }));
    const target = h.cols.map((pts) => pts.map((p) => p.clone().applyMatrix4(HM)));
    const first = !h.P;
    if (first) h.P = target.map((col) => col.map((p) => p.clone()));
    const P = h.P, body = bodyColliders(fig, THREE);
    for (const f of others) {
      const o = bodyColliders(f, THREE);
      body.ell.push(...o.ell);
      body.cap.push(...o.cap);
    }
    const [k0, k1] = h.style.stiff;
    const g = new THREE.Vector3(0, -0.004 * s, 0);
    const F = SCALP_ROWS + 1;
    for (let it = 0; it < (first ? 40 : ITER); it++) {
      for (let c = 0; c < COLS; c++) {
        const pc = P[c], tc = target[c];
        for (let i = 0; i < F; i++) pc[i].copy(tc[i]);
        for (let i = F; i < ROWS; i++) pc[i].add(g).lerp(tc[i], k0 + ((k1 - k0) * (i - F)) / (ROWS - 1 - F));
      }
      // 隣の房との間隔（広がりすぎ・寄りすぎを半分ずつ戻す）
      for (let c = 0; c < COLS; c++) {
        const c2 = (c + 1) % COLS;
        for (let i = F; i < ROWS; i++) {
          if (!h.joined[c][i]) continue;
          const a = P[c][i], b = P[c2][i], r = h.across[c][i] * s;
          const v = b.clone().sub(a), l = v.length();
          const k = l > r * 1.25 ? l - r * 1.25 : l < r * 0.6 ? l - r * 0.6 : 0;
          if (!k || l < 1e-6) continue;
          v.multiplyScalar((0.5 * k) / l);
          a.add(v);
          b.sub(v);
        }
      }
      // 房の長さ（根元から順に子だけ動かす）と体の外へ
      for (let c = 0; c < COLS; c++) {
        const pc = P[c];
        for (let i = F; i < ROWS; i++) {
          const v = pc[i].clone().sub(pc[i - 1]), l = v.length();
          if (l > 1e-6) pc[i].copy(pc[i - 1]).addScaledVector(v, (h.seg[c][i] * s) / l);
          pushOut(pc[i], heads, body);
        }
      }
    }
    // root のローカルへ（メッシュは root の子。表示・半透明の切り替えに従う）
    const inv = fig.root.matrixWorld.clone().invert();
    const arr = h.mesh.geometry.attributes.position.array;
    for (let c = 0; c < COLS; c++) for (let i = 0; i < ROWS; i++) q.copy(P[c][i]).applyMatrix4(inv).toArray(arr, 3 * (c * ROWS + i));
    h.mesh.geometry.attributes.position.needsUpdate = true;
    h.mesh.geometry.computeVertexNormals();
  }

  ctx.onFrame(() => {
    for (const fig of Object.values(figs)) {
      let h = hairs.get(fig) ?? build(fig);
      if (h.mesh.parent !== fig.root) fig.root.add(h.mesh);
      h.mesh.visible = on;
      if (on && fig.root.visible) step(fig, h);
    }
  });

  const btn = document.createElement('button');
  const label = () => { btn.textContent = `髪: ${on ? '表示' : '非表示'}`; };
  btn.addEventListener('click', () => {
    on = !on;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* 保存できなくても動く */ }
    label();
  });
  label();
  ctx.bar.append(btn);
  ctx.hair = { get on() { return on; }, set on(v) { if (v !== on) btn.click(); } };
}

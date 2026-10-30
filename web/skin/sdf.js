// 皮膚の生成: 部位の距離場 → surface nets → 骨の重み。three に依存しない（Worker で動かす）。
//
// part: { id, kind, m, p, bone, box, mesh: {body?, left?, right?: mod}, layer, knots?, ax? }
//   kind 'ell' 楕円体 p=[rx,ry,rz,taper?]。taper > 0 は +Y 側を、< 0 は -Y 側を (y/ry)² で細める
//        'cone' 原点から -Y へ長さ p[0]、半径 p[1]→p[2]、p[3] は Z 方向の半径の倍率（省略 1）
//        'palm' 角の丸い板 p=[hx,hy,hz,round]
//   m: 静止形の座標 → 部位の座標（行優先 3x4、回転は直交）
//   layer: 'bone' | 'muscle' | 'fat'（皮膚の下にあるもの。fat は胸のような脂肪の塊で、真下の部位にはならない）
//   knots: [[u, bone], ...] u は部位の軸に沿った 0..1（u = ax[0] * 部位の y + ax[1]）。筋は起始から停止へ骨の重みを移す
//          axw = [dx, dy, dz, c] があれば u は静止形の座標で dx·x + dy·y + dz·z + c（胴の中央は背骨の高さ）
//   rigid: 骨に固く付ける（手足の骨と頭）。それ以外は隣の筋の骨へも分ける
//   mod: null か [s, u0, len, ucut]。u は円錐の先端から根元へ向かう距離。s=1 は先端側を、s=-1 は根元側を
//        u0 から (u0-u)²/len だけ内へ沈め、ucut で切る。体と手は u0 で接して入れ替わり、それぞれの端は相手の内側で閉じる
// edge: [a, b, k, wr, jx, jy, jz, fallR]  滑らかに結合する部位の組。k は結合の幅（0 は重みだけ分ける）、wr は重みを分ける幅、
//        fallR > 0 なら結合を関節点 j から fallR の範囲に限る
// fat: { base, regions: [{ m, r: [rx,ry,rz], t, box }], holes: [[x,y,z,r0,r1]] }
//   脂肪の厚み t(x) = base + Σ t·(1-q²)²（q は楕円体で正規化した距離）。holes の球の内側（r0 まで 0、r1 で 1）では 0 にする

const sq = (x) => x * x;

export function local(m, x, y, z, out) {
  out[0] = m[0] * x + m[1] * y + m[2] * z + m[3];
  out[1] = m[4] * x + m[5] * y + m[6] * z + m[7];
  out[2] = m[8] * x + m[9] * y + m[10] * z + m[11];
}

// 楕円体の距離。外側で面に近い所は最近点を Newton 法で求める（Eberly）。
// 近似 k0(k0-1)/k1 は平たい楕円体の斜め外で距離を数分の一に見積もり、面が膨らんで膜やひれになる
const E0 = 0.035, E1 = 0.06;
function sdEll(x, y, z, r) {
  const a = r[0] * r[0], b = r[1] * r[1], c = r[2] * r[2];
  const k0 = Math.sqrt(x * x / a + y * y / b + z * z / c);
  const k1 = Math.sqrt(x * x / (a * a) + y * y / (b * b) + z * z / (c * c));
  if (k1 < 1e-9) return -Math.min(r[0], r[1], r[2]);
  const approx = (k0 * (k0 - 1)) / k1;
  if (k0 <= 1) return approx;
  const rmin = Math.min(r[0], r[1], r[2]), rmax = Math.max(r[0], r[1], r[2]);
  const far = Math.max(approx, (k0 - 1) * rmin);
  // 丸に近い楕円体と、遠い所（面の形に関わらない）は近似で足りる。境目は連続になるよう E0..E1 で混ぜる
  if (rmax < 1.8 * rmin || far > E1) return far;
  // Σ (rᵢ² pᵢ / (t + rᵢ²))² / rᵢ² = 1 を t ≥ 0 で解く。左から Newton で単調に近づく
  const ax = x * r[0], ay = y * r[1], az = z * r[2];
  let t = Math.max(0, (k0 - 1) * rmin * rmin);
  for (let i = 0; i < 12; i++) {
    const ex = ax / (t + a), ey = ay / (t + b), ez = az / (t + c);
    const F = ex * ex + ey * ey + ez * ez - 1;
    if (F < 1e-7) break;
    const dF = -2 * (ex * ex / (t + a) + ey * ey / (t + b) + ez * ez / (t + c));
    t -= F / dF;
  }
  const d = Math.min(Math.max(Math.hypot(x - a * x / (t + a), y - b * y / (t + b), z - c * z / (t + c)), far), (k0 - 1) * rmax);
  if (far <= E0) return d;
  const w = (far - E0) / (E1 - E0);
  return d + (far - d) * w * w * (3 - 2 * w);
}

// 原点（半径 r1）から (0,-h,0)（半径 r2）への円錐を球でつないだもの
function sdCone(x, y, z, h, r1, r2) {
  const qx = Math.hypot(x, z), qy = -y;
  const b = (r1 - r2) / h, a = Math.sqrt(1 - b * b);
  const k = -b * qx + a * qy;
  if (k < 0) return Math.hypot(qx, qy) - r1;
  if (k > a * h) return Math.hypot(qx, qy - h) - r2;
  return a * qx + b * qy - r1;
}

// 手のひら: 厚み x、長さ y（+Y が手首）、幅 z。手首側ほど幅を細める
function sdPalm(x, y, z, p) {
  const t = 0.9 - 0.1 * Math.max(-1, Math.min(1, y / p[1]));
  const r = p[3];
  const qx = Math.abs(x) - p[0] + r, qy = Math.abs(y) - p[1] + r, qz = Math.abs(z) - p[2] * t + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

// 断面を積み重ねた形: p = { ys（上から下へ）, w 半幅, f 前の端, b 後ろの端, n 断面の丸さ（超楕円の指数） }。
// 高さ y の断面は x 方向 ±w、z 方向 b..f の超楕円。上下の端は丸く閉じる（端の断面の大きさの球に近い）
function sdLoft(x, y, z, p) {
  const { ys, w, f, b, n, cleft, groin, lobe } = p, last = ys.length - 1;
  const yc = Math.min(ys[0], Math.max(ys[last], y));
  let i = 0;
  while (i < last - 1 && ys[i + 1] > yc) i++;
  const t = (ys[i] - yc) / (ys[i] - ys[i + 1]);
  // 段の間は Catmull-Rom でなめらかにつなぐ（直線でつなぐと段の境で面の向きが折れて濃淡が階段になる）
  const cr = (a) => {
    const p0 = a[Math.max(0, i - 1)], p1 = a[i], p2 = a[i + 1], p3 = a[Math.min(last, i + 2)];
    return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  };
  const W = cr(w), Fz = cr(f), Bz = cr(b);
  const c = (Fz + Bz) / 2, d = (Fz - Bz) / 2;
  const q = (Math.abs(x) / W) ** n + (Math.abs(z - c) / d) ** n;
  const r = Math.min(W, d);
  let ds = (q ** (1 / n) - 1) * r;
  // お尻: 後ろ半分を左右二つの丸（中心 ±0.5W、半径 0.55W・奥行き d）に寄せる。lobe はその割合
  if (lobe && z < c) {
    const L = cr(lobe);
    if (L > 1e-4) {
      const rx = 0.52 * W, dl = (Math.hypot((Math.abs(x) - 0.5 * W) / rx, (z - c) / d) - 1) * Math.min(rx, d);
      ds += (dl - ds) * L * Math.min(1, (c - z) / d * 3);
    }
  }
  // 後ろの中央の溝（お尻の割れ目）: 深さ cleft、幅は深さに比例。後ろ半分だけ
  if (cleft) {
    const k = cr(cleft);
    if (k > 1e-4 && z < c) ds += k * Math.exp(-((x / (0.35 * k + 0.006)) ** 2)) * Math.min(1, (c - z) / d * 2);
  }
  // 前の鼠蹊部の溝: 前の面で、中央から groin[0] の所を中心に斜めに下りる線（高さで外から内へ）
  if (groin) {
    const g = cr(groin);
    if (g > 1e-4 && z > c) ds += 0.006 * Math.exp(-(((Math.abs(x) - g) / 0.008) ** 2)) * Math.min(1, (z - c) / d * 2);
  }
  const dy = y > ys[0] ? y - ys[0] : y < ys[last] ? ys[last] - y : 0;
  if (dy === 0) return ds;
  // 端の外: 端の断面の上に丸い蓋（蓋の高さは断面の小さい方の半径の 0.8）
  const cap = r * 0.8;
  return Math.hypot(Math.max(ds + cap, 0), dy) - cap + Math.min(ds + cap, 0);
}

// m: 点の座標 → 部位の座標。省略すると静止形の pt.m。L に部位の座標が残る
export const L = new Float64Array(3);
export function partDist(pt, x, y, z, mod = null, m = pt.m) {
  local(m, x, y, z, L);
  const p = pt.p;
  if (pt.kind === 'ell') {
    if (!p[3]) return sdEll(L[0], L[1], L[2], p);
    const s = 1 - Math.abs(p[3]) * sq(Math.max(0, Math.min(1, Math.sign(p[3]) * L[1] / p[1])));
    return sdEll(L[0] / s, L[1], L[2] / s, p) * s;
  }
  if (pt.kind === 'palm') return sdPalm(L[0], L[1], L[2], p);
  if (pt.kind === 'loft') return sdLoft(L[0], L[1], L[2], p);
  const fz = p[3] ?? 1;
  let d = sdCone(L[0], L[1], L[2] / fz, p[0], p[1], p[2]) * Math.min(1, fz);
  if (mod) {
    const [s, u0, len, ucut] = mod;
    const u = L[1] + p[0];
    d += sq(Math.max(0, s * (u0 - u))) / len;
    d = Math.max(d, s * (ucut - u));
  }
  return d;
}

// 脂肪の厚み（静止形の座標）
export function fatAt(fat, x, y, z, regions = fat.regions) {
  let t = fat.base ?? 0;
  for (const r of regions) {
    local(r.m, x, y, z, L);
    const q = sq(L[0] / r.r[0]) + sq(L[1] / r.r[1]) + sq(L[2] / r.r[2]);
    if (q < 1) t += r.t * sq(1 - q);
  }
  if (t === 0) return 0;
  for (const [hx, hy, hz, r0, r1] of fat.holes) {
    const d = Math.hypot(x - hx, y - hy, z - hz);
    if (d < r1) t *= Math.max(0, (d - r0) / (r1 - r0));
  }
  return t;
}

// 部位の集合と結合の規則から、点の値を返す関数を作る
// active: 部位の番号（Int32Array）、activeEdges: EA（結合を 8 個ずつ並べた Float64Array）の中の結合の番号
const CLIP_ROUND = 0.004;
function field(parts, mods, fat, EA, clip = null) {
  const n = parts.length;
  const d = new Float64Array(n);
  return (x, y, z, active, activeEdges, activeFat) => {
    let f = Infinity;
    for (let q = 0; q < active.length; q++) {
      const i = active[q];
      const v = partDist(parts[i], x, y, z, mods[i]);
      d[i] = v;
      if (v < f) f = v;
    }
    for (let q = 0; q < activeEdges.length; q++) {
      const o = activeEdges[q] * 8;
      const a = d[EA[o]], b = d[EA[o + 1]], k = EA[o + 2];
      const h = k - Math.abs(a - b);
      if (h <= 0) continue;
      let c = (h * h) / (4 * k);
      const fall = EA[o + 7];
      if (fall > 0) {
        const r = 1 - ((x - EA[o + 4]) ** 2 + (y - EA[o + 5]) ** 2 + (z - EA[o + 6]) ** 2) / (fall * fall);
        c *= r > 0 ? r * r : 0;
      }
      const v = (a < b ? a : b) - c;
      if (v < f) f = v;
    }
    if (fat) f -= fatAt(fat, x, y, z, activeFat);
    if (clip) {
      for (const c of clip) {
        const g = c[0] === 0 ? c[1] * x + c[2] * y + c[3] * z - c[4] : c[4] - Math.hypot(x - c[1], y - c[2], z - c[3]);
        // 切り口の縁は CLIP_ROUND の幅で丸める（角のままだと面の格子が縁でぎざぎざになる）
        const kr = c[5] ?? CLIP_ROUND, h = kr - Math.abs(f - g);
        f = (f > g ? f : g) + (h > 0 ? (h * h) / (4 * kr) : 0);
      }
    }
    return f;
  };
}

const boxHit = (b, lo, hi) => b[0] <= hi[0] && b[3] >= lo[0] && b[1] <= hi[1] && b[4] >= lo[1] && b[2] <= hi[2] && b[5] >= lo[2];

// 面を作る部位の番号と、その間の結合。which: 'body' | 'left' | 'right'、layers: 使う層（省略は全部）
export function select(parts, edges, which, layers = null) {
  const ids = parts.map((p, i) => (p.mesh[which] !== undefined && (!layers || layers.includes(p.layer)) ? i : -1)).filter((i) => i >= 0);
  const inMesh = new Set(ids);
  return { ids, edges: edges.filter((e) => inMesh.has(e[0]) && inMesh.has(e[1])) };
}

// grid: { g: 格子の座標 → 静止形（3x4、省略は単位行列）, min: [x,y,z], n: [nx,ny,nz], cell }
// fat: 皮膚に足す脂肪（null は足さない）
// clip: 取り除く範囲の並び。[0, nx, ny, nz, d] は n·x > d の側、[1, cx, cy, cz, r] は球の内側。6 つ目は切り口の縁を丸める幅（省略は CLIP_ROUND）
export function extract(parts, edges, grid, which, layers = null, fat = null, clip = null) {
  const { ids, edges: shapeEdges } = select(parts, edges, which, layers);
  const mods = parts.map((p) => p.mesh[which] ?? null);
  const EA = Float64Array.from(shapeEdges.flat());
  const F = field(parts, mods, fat, EA, clip);
  // 法線は前腕の沈め込みを除いた場で取る。体と手が入れ替わる所で両方の陰影をそろえる
  const Fn = field(parts, mods.map(() => null), fat, EA, clip);
  const G = grid.g ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  const [nx, ny, nz] = grid.n, c = grid.cell;
  const W = new Float64Array(3);
  const toRest = (i, j, k, out) => local(G, grid.min[0] + i * c, grid.min[1] + j * c, grid.min[2] + k * c, out);
  const fatRegions = fat ? fat.regions : [];

  // 8 格子ずつのブロックに分け、近くにある部位だけを評価する
  const B = 4;
  const bn = [Math.ceil(nx / B), Math.ceil(ny / B), Math.ceil(nz / B)];
  // 部位はまず範囲の箱で選び、ブロックの中心での距離で絞る。ブロックの中で面に届かない部位は値を変えない
  const maxK = Math.max(0.01, ...shapeEdges.map((e) => e[2]));
  const base = fat?.base ?? 0;
  const half = c * B * 0.5 * Math.sqrt(3);
  const pad0 = c * B * 0.5 + maxK;
  const nb = bn[0] * bn[1] * bn[2];
  const blockParts = new Array(nb), blockEdges = new Array(nb), blockFat = new Array(nb), fatMax = new Float64Array(nb);
  const lo = [0, 0, 0], hi = [0, 0, 0];
  const on = new Int32Array(parts.length);
  const grow = (pad) => { for (let a = 0; a < 3; a++) { lo[a] -= pad; hi[a] += pad; } };
  for (let bk = 0; bk < bn[2]; bk++) for (let bj = 0; bj < bn[1]; bj++) for (let bi = 0; bi < bn[0]; bi++) {
    lo[0] = lo[1] = lo[2] = Infinity; hi[0] = hi[1] = hi[2] = -Infinity;
    for (const ci of [0, B]) for (const cj of [0, B]) for (const ck of [0, B]) {
      toRest(bi * B + ci, bj * B + cj, bk * B + ck, W);
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], W[a]); hi[a] = Math.max(hi[a], W[a]); }
    }
    grow(pad0);
    const b = bi + bn[0] * (bj + bn[1] * bk);
    const fr = fatRegions.filter((r) => boxHit(r.box, lo, hi));
    const fmax = base + fr.reduce((s, r) => s + r.t, 0);
    fatMax[b] = fmax;
    grow(fmax);
    toRest(bi * B + B / 2, bj * B + B / 2, bk * B + B / 2, W);
    const reach = half * 1.3 + maxK + fmax + c;
    const act = ids.filter((i) => boxHit(parts[i].box, lo, hi) && partDist(parts[i], W[0], W[1], W[2], mods[i]) < reach);
    for (const i of act) on[i] = b + 1;
    blockParts[b] = Int32Array.from(act);
    const es = [];
    if (act.length > 1) for (let e = 0; e < shapeEdges.length; e++) if (on[shapeEdges[e][0]] === b + 1 && on[shapeEdges[e][1]] === b + 1) es.push(e);
    blockEdges[b] = Int32Array.from(es);
    blockFat[b] = act.length ? fr : [];
  }
  const blockOf = (i, j, k) => Math.min(bn[0] - 1, (i / B) | 0) + bn[0] * (Math.min(bn[1] - 1, (j / B) | 0) + bn[1] * Math.min(bn[2] - 1, (k / B) | 0));

  // 値は面の近くだけ正確に求める。ブロックを 8→4→2→1 と割り、中心の値が勾配の上限 × 半径より大きければ
  // その範囲に面は無いので、符号の合った下限の値で埋める。勾配の上限は楕円体の近似と脂肪の傾きから見積もる
  const vals = new Float32Array(nx * ny * nz);
  const idx = (i, j, k) => i + nx * (j + ny * k);
  vals.fill(c * B);
  const lip = blockFat.map((fr) => 1.3 + fr.reduce((s, r) => s + 1.6 * r.t / Math.min(r.r[0], r.r[1], r.r[2]), 0));
  const coarse = new Uint8Array(nb);
  const fill = (i0, j0, k0, n, b) => {
    const i1 = Math.min(i0 + n, nx - 1), j1 = Math.min(j0 + n, ny - 1), k1 = Math.min(k0 + n, nz - 1);
    const a0 = Math.max(i0, 1), b0 = Math.max(j0, 1), c0 = Math.max(k0, 1);
    if (a0 >= i1 || b0 >= j1 || c0 >= k1) return;
    const act = blockParts[b], ae = blockEdges[b], af = blockFat[b];
    if (n > 1) {
      const ci = (a0 + i1 - 1) / 2, cj = (b0 + j1 - 1) / 2, ck = (c0 + k1 - 1) / 2;
      toRest(ci, cj, ck, W);
      const f = F(W[0], W[1], W[2], act, ae, af);
      // 脂肪の厚みの変化は傾きの上限と、ブロックでの厚みの上限の小さい方で見積もる
      const R0 = Math.hypot(i1 - 1 - ci, j1 - 1 - cj, k1 - 1 - ck) * c;
      const r = R0 * 1.3 + Math.min(fatMax[b], R0 * (lip[b] - 1.3));
      if (Math.abs(f) > r + c * 0.5) {
        const v = Math.sign(f) * (Math.abs(f) - r);
        for (let k = c0; k < k1; k++) for (let j = b0; j < j1; j++) for (let i = a0; i < i1; i++) vals[idx(i, j, k)] = v;
        return;
      }
      coarse[b] = 1;
      const h = n / 2;
      for (const dk of [0, h]) for (const dj of [0, h]) for (const di of [0, h]) fill(i0 + di, j0 + dj, k0 + dk, h, b);
      return;
    }
    toRest(i0, j0, k0, W);
    vals[idx(i0, j0, k0)] = F(W[0], W[1], W[2], act, ae, af);
  };
  for (let bk = 0; bk < bn[2]; bk++) for (let bj = 0; bj < bn[1]; bj++) for (let bi = 0; bi < bn[0]; bi++) {
    const b = bi + bn[0] * (bj + bn[1] * bk);
    if (blockParts[b].length) fill(bi * B, bj * B, bk * B, B, b);
  }
  // 面がありうるブロック（一つの値で埋まらなかったもの）と、その -X/-Y/-Z 側の隣だけを surface nets で見る
  const near = new Uint8Array(nb);
  for (let bk = 0; bk < bn[2]; bk++) for (let bj = 0; bj < bn[1]; bj++) for (let bi = 0; bi < bn[0]; bi++) {
    const b = bi + bn[0] * (bj + bn[1] * bk);
    if (!coarse[b]) continue;
    for (const [di, dj, dk] of [[0, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 0, -1], [-1, -1, 0], [-1, 0, -1], [0, -1, -1], [-1, -1, -1]]) {
      const a = bi + di, bb = bj + dj, cc = bk + dk;
      if (a >= 0 && bb >= 0 && cc >= 0) near[a + bn[0] * (bb + bn[1] * cc)] = 1;
    }
  }
  const blocks = [];
  for (let b = 0; b < nb; b++) if (near[b]) blocks.push(b);
  const cellsOf = function* (lo0, hi0) {
    for (const b of blocks) {
      const bi = b % bn[0], bj = ((b / bn[0]) | 0) % bn[1], bk = (b / (bn[0] * bn[1])) | 0;
      const ie = Math.min(bi * B + B, hi0[0]), je = Math.min(bj * B + B, hi0[1]), ke = Math.min(bk * B + B, hi0[2]);
      for (let k = Math.max(bk * B, lo0); k < ke; k++) for (let j = Math.max(bj * B, lo0); j < je; j++) for (let i = Math.max(bi * B, lo0); i < ie; i++) yield [i, j, k];
    }
  };

  // surface nets: 符号の変わる格子ごとに頂点を 1 つ、辺ごとに四角形を 1 つ
  const cellV = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos = [], cellOf = [];
  const CORNER = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float64Array(8);
  for (const [i, j, k] of cellsOf(0, [nx - 1, ny - 1, nz - 1])) {
    let neg = 0;
    for (let q = 0; q < 8; q++) {
      cv[q] = vals[idx(i + CORNER[q][0], j + CORNER[q][1], k + CORNER[q][2])];
      if (cv[q] < 0) neg++;
    }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, m = 0;
    for (const [a, b] of EDGES) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      sx += CORNER[a][0] + (CORNER[b][0] - CORNER[a][0]) * t;
      sy += CORNER[a][1] + (CORNER[b][1] - CORNER[a][1]) * t;
      sz += CORNER[a][2] + (CORNER[b][2] - CORNER[a][2]) * t;
      m++;
    }
    cellV[cidx(i, j, k)] = pos.length / 3;
    pos.push(i + sx / m, j + sy / m, k + sz / m);
    cellOf.push(blockOf(i, j, k));
  }
  const tris = [];
  for (const [i, j, k] of cellsOf(1, [nx - 1, ny - 1, nz - 1])) {
    const v0 = vals[idx(i, j, k)] < 0;
    // +X, +Y, +Z の辺。辺を囲む 4 つの格子の頂点で四角形を作る
    for (let a = 0; a < 3; a++) {
      const [di, dj, dk] = a === 0 ? [1, 0, 0] : a === 1 ? [0, 1, 0] : [0, 0, 1];
      const v1 = vals[idx(i + di, j + dj, k + dk)] < 0;
      if (v0 === v1) continue;
      // 辺に垂直な 2 軸
      const [u, w] = a === 0 ? [[0, 1, 0], [0, 0, 1]] : a === 1 ? [[0, 0, 1], [1, 0, 0]] : [[1, 0, 0], [0, 1, 0]];
      const at = (su, sw) => cellV[cidx(i - su * u[0] - sw * w[0], j - su * u[1] - sw * w[1], k - su * u[2] - sw * w[2])];
      const q = [at(1, 1), at(0, 1), at(0, 0), at(1, 0)];
      if (q.some((x) => x < 0)) continue;
      tris.push(q);
    }
  }

  // 頂点を面の上へ寄せ、法線を場の勾配から取る
  const nv = pos.length / 3;
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3);
  const e = c * 0.1;
  // 前進差分。f0 はその点の値
  const grad = (x, y, z, act, ae, af, g, f0, f = F) => {
    g[0] = f(x + e, y, z, act, ae, af) - f0;
    g[1] = f(x, y + e, z, act, ae, af) - f0;
    g[2] = f(x, y, z + e, act, ae, af) - f0;
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    g[0] /= l; g[1] /= l; g[2] /= l;
  };
  const g = [0, 0, 0];
  // 頂点の格子が部位の無いブロックにあるとき（隣のブロックの面が境をまたぐ）は、部位のある隣のブロックで評価する
  const blockAt = (v) => {
    const b = cellOf[v];
    if (blockParts[b].length) return b;
    const bi = b % bn[0], bj = ((b / bn[0]) | 0) % bn[1], bk = (b / (bn[0] * bn[1])) | 0;
    for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = bi + di, bb = bj + dj, cc = bk + dk;
      if (a < 0 || bb < 0 || cc < 0 || a >= bn[0] || bb >= bn[1] || cc >= bn[2]) continue;
      const q = a + bn[0] * (bb + bn[1] * cc);
      if (blockParts[q].length) return q;
    }
    return b;
  };
  for (let v = 0; v < nv; v++) {
    const b = blockAt(v);
    const act = blockParts[b], ae = blockEdges[b], af = blockFat[b];
    toRest(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2], W);
    const x0 = W[0], y0 = W[1], z0 = W[2];
    let x = x0, y = y0, z = z0;
    const f = F(x, y, z, act, ae, af);
    if (!Number.isFinite(f)) { P.set([x, y, z], 3 * v); N.set([0, 1, 0], 3 * v); continue; }
    grad(x, y, z, act, ae, af, g, f);
    x -= f * g[0]; y -= f * g[1]; z -= f * g[2];
    const dx = x - x0, dy = y - y0, dz = z - z0, dl = Math.hypot(dx, dy, dz);
    if (dl > c * 0.7) { const s = c * 0.7 / dl; x = x0 + dx * s; y = y0 + dy * s; z = z0 + dz * s; }
    grad(x, y, z, act, ae, af, g, Fn(x, y, z, act, ae, af), Fn);
    P.set([x, y, z], 3 * v);
    N.set(g, 3 * v);
  }

  // 四角形を短い対角線で 2 つの三角形にし、向きを法線に合わせる
  const I = new Uint32Array(tris.length * 6);
  let t = 0;
  const pushTri = (a, b, cc) => {
    const ax = P[3 * b] - P[3 * a], ay = P[3 * b + 1] - P[3 * a + 1], az = P[3 * b + 2] - P[3 * a + 2];
    const bx = P[3 * cc] - P[3 * a], by = P[3 * cc + 1] - P[3 * a + 1], bz = P[3 * cc + 2] - P[3 * a + 2];
    const nx_ = ay * bz - az * by, ny_ = az * bx - ax * bz, nz_ = ax * by - ay * bx;
    const s = nx_ * (N[3 * a] + N[3 * b] + N[3 * cc]) + ny_ * (N[3 * a + 1] + N[3 * b + 1] + N[3 * cc + 1]) + nz_ * (N[3 * a + 2] + N[3 * b + 2] + N[3 * cc + 2]);
    if (s >= 0) { I[t++] = a; I[t++] = b; I[t++] = cc; } else { I[t++] = a; I[t++] = cc; I[t++] = b; }
  };
  const d2 = (a, b) => sq(P[3 * a] - P[3 * b]) + sq(P[3 * a + 1] - P[3 * b + 1]) + sq(P[3 * a + 2] - P[3 * b + 2]);
  for (const [a, b, cc, dd] of tris) {
    if (d2(a, cc) <= d2(b, dd)) { pushTri(a, b, cc); pushTri(a, cc, dd); } else { pushTri(a, b, dd); pushTri(b, cc, dd); }
  }
  return { position: P, normal: N, index: I.subarray(0, t) };
}

const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// 部位の骨の重みを byBone へ k 倍で足す。knots のある筋は軸に沿って起始の骨から停止の骨へ移る
function addBones(pt, x, y, z, byBone, k) {
  const kn = pt.knots;
  if (!kn) { byBone.set(pt.bone, (byBone.get(pt.bone) ?? 0) + k); return; }
  let u;
  if (pt.axw) u = pt.axw[0] * x + pt.axw[1] * y + pt.axw[2] * z + pt.axw[3];
  else { local(pt.m, x, y, z, L); u = pt.ax[0] * L[1] + pt.ax[1]; }
  if (u <= kn[0][0] || kn.length === 1) { byBone.set(kn[0][1], (byBone.get(kn[0][1]) ?? 0) + k); return; }
  let i = 0;
  while (i < kn.length - 1 && u > kn[i + 1][0]) i++;
  if (i === kn.length - 1) { byBone.set(kn[i][1], (byBone.get(kn[i][1]) ?? 0) + k); return; }
  const t = smooth01((u - kn[i][0]) / (kn[i + 1][0] - kn[i][0]));
  byBone.set(kn[i][1], (byBone.get(kn[i][1]) ?? 0) + k * (1 - t));
  byBone.set(kn[i + 1][1], (byBone.get(kn[i + 1][1]) ?? 0) + k * t);
}

// 頂点ごとに最大 4 本の骨と重み、真下の部位（owner）、真下の部位までの深さ（thick、皮下の脂肪の厚み）。
// 骨の部位が真下なら骨に固く付け、筋なら軸に沿って骨を移し、隣の筋へ wr の幅で分ける。脂肪は真下のものに従う
export function weights(parts, edges, P, ids = parts.map((_, i) => i)) {
  const nv = P.length / 3;
  const inSet = new Set(ids);
  const adj = parts.map(() => []);
  for (const e of edges) {
    if (!inSet.has(e[0]) || !inSet.has(e[1]) || parts[e[0]].layer === 'fat' || parts[e[1]].layer === 'fat') continue;
    adj[e[0]].push([e[1], e[3]]); adj[e[1]].push([e[0], e[3]]);
  }
  const pad = Math.max(0.03, ...edges.map((e) => e[3]));
  const SI = new Uint16Array(nv * 4), SW = new Float32Array(nv * 4), owner = new Uint16Array(nv);
  const d = new Float64Array(parts.length).fill(Infinity);
  ids = ids.filter((i) => parts[i].layer !== 'fat');
  const cand = ids.map((i) => parts[i]);
  const thick = new Float32Array(nv);
  for (let v = 0; v < nv; v++) {
    const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
    let o = -1, best = Infinity;
    for (let c = 0; c < cand.length; c++) {
      const pt = cand[c], b = pt.box, i = ids[c];
      d[i] = Infinity;
      if (x < b[0] - pad || x > b[3] + pad || y < b[1] - pad || y > b[4] + pad || z < b[2] - pad || z > b[5] + pad) continue;
      d[i] = partDist(pt, x, y, z, null);
      if (d[i] < best) { best = d[i]; o = i; }
    }
    // 脂肪の塊（胸など）の先は箱の近くに部位が無いので、全部から探す
    if (o < 0) {
      for (let c = 0; c < cand.length; c++) {
        const i = ids[c];
        d[i] = partDist(cand[c], x, y, z, null);
        if (d[i] < best) { best = d[i]; o = i; }
      }
      if (o < 0) o = ids[0];
    }
    owner[v] = o;
    thick[v] = Math.max(0, best);
    const byBone = new Map();
    addBones(parts[o], x, y, z, byBone, 1);
    if (!parts[o].rigid) {
      for (const [j, wr] of adj[o]) {
        if (parts[j].rigid || !(d[j] < Infinity)) continue;
        const w = sq(Math.max(0, 1 - (d[j] - best) / wr));
        if (w > 0) addBones(parts[j], x, y, z, byBone, w * 0.5);
      }
    }
    const top = [...byBone].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, [, w]) => s + w, 0);
    top.forEach(([bone, w], q) => { SI[4 * v + q] = bone; SW[4 * v + q] = w / sum; });
  }
  return { skinIndex: SI, skinWeight: SW, owner, thick };
}

// 肩甲骨の板の外・下の胴の皮膚の、胸の骨の重みの一部を肩甲骨へ移す。
// 腕を上げると下角は外・前へ回り込むが、その上の広背筋の皮膚が胸に残ると、板の縁で皮膚が折れ重なって背に穴が開いた。
// 移す割合は k × spreadAt（板からの距離 dist で 1 → 0、背骨から 6〜9cm で 0 → 1）。dist 12cm では範囲の前の縁（脇腹）で折れて縦の切れ目が出た
export function neighbors(index, nv) {
  const deg = new Uint32Array(nv + 1);
  const ends = [];
  for (let t = 0; t < index.length; t += 3) for (let a = 0; a < 3; a++) ends.push(index[t + a], index[t + (a + 1) % 3]);
  const seen = new Set();
  const E = [];
  for (let q = 0; q < ends.length; q += 2) {
    const u = ends[q], v = ends[q + 1];
    const key = u < v ? u * nv + v : v * nv + u;
    if (seen.has(key)) continue;
    seen.add(key);
    E.push(u, v);
    deg[u + 1]++; deg[v + 1]++;
  }
  for (let v = 0; v < nv; v++) deg[v + 1] += deg[v];
  const adj = new Uint32Array(deg[nv]);
  const fillAt = deg.slice(0, nv);
  for (let q = 0; q < E.length; q += 2) { adj[fillAt[E[q]]++] = E[q + 1]; adj[fillAt[E[q + 1]]++] = E[q]; }
  return { start: deg, adj };
}

// 重みをメッシュの隣の頂点となじませる。fixed[v] が真の頂点は動かさない（手首の重なりを体と手でそろえるため）。
// 頂点ごとに骨を K 個まで持ち、少ない重みから捨てる。最後に 4 本へ絞る
export function smoothWeights(index, SI, SW, fixed, iterations = 4, lambda = 0.5) {
  const nv = SI.length / 4, K = 8;
  const { start, adj } = neighbors(index, nv);
  let B = new Int32Array(nv * K).fill(-1), Wt = new Float32Array(nv * K);
  for (let v = 0; v < nv; v++) for (let q = 0; q < 4; q++) if (SW[4 * v + q] > 0) { B[v * K + q] = SI[4 * v + q]; Wt[v * K + q] = SW[4 * v + q]; }
  let B2 = new Int32Array(nv * K), W2 = new Float32Array(nv * K);
  const tb = new Int32Array(64), tw = new Float32Array(64);
  for (let it = 0; it < iterations; it++) {
    for (let v = 0; v < nv; v++) {
      const o = v * K;
      const n0 = start[v], n1 = start[v + 1];
      if (fixed[v] || n1 === n0) { B2.set(B.subarray(o, o + K), o); W2.set(Wt.subarray(o, o + K), o); continue; }
      let m = 0;
      const add = (b, w) => {
        for (let q = 0; q < m; q++) if (tb[q] === b) { tw[q] += w; return; }
        if (m < 64) { tb[m] = b; tw[m] = w; m++; }
      };
      for (let q = 0; q < K; q++) if (B[o + q] >= 0) add(B[o + q], (1 - lambda) * Wt[o + q]);
      const k = lambda / (n1 - n0);
      for (let e = n0; e < n1; e++) { const u = adj[e] * K; for (let q = 0; q < K; q++) if (B[u + q] >= 0) add(B[u + q], k * Wt[u + q]); }
      // 大きい順に K 個
      let sum = 0;
      for (let q = 0; q < K; q++) {
        let bi = -1, bw = 0;
        for (let r = 0; r < m; r++) if (tw[r] > bw) { bw = tw[r]; bi = r; }
        if (bi < 0) { B2[o + q] = -1; W2[o + q] = 0; continue; }
        B2[o + q] = tb[bi]; W2[o + q] = bw; sum += bw; tw[bi] = 0;
      }
      for (let q = 0; q < K; q++) W2[o + q] /= sum || 1;
    }
    [B, B2] = [B2, B]; [Wt, W2] = [W2, Wt];
  }
  for (let v = 0; v < nv; v++) {
    const o = v * K;
    let sum = 0;
    for (let q = 0; q < 4; q++) sum += B[o + q] >= 0 ? Wt[o + q] : 0;
    for (let q = 0; q < 4; q++) { SI[4 * v + q] = B[o + q] >= 0 ? B[o + q] : 0; SW[4 * v + q] = B[o + q] >= 0 ? Wt[o + q] / (sum || 1) : 0; }
  }
}

// 皮膚のならし（Taubin）: 静止形の頂点を隣の平均へ寄せ、縮んだ分を押し戻す。部位の境の折れ目や段を、皮膚と皮下脂肪が覆うように丸める。
// strength[v] は 0..1（0 は動かさない）。

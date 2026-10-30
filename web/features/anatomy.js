// 表示: 人形 / 解剖。解剖は人形を透かし、骨と筋（skin/anatomy.js の形）を人形の関節に結びつけて見せる。骨と筋は初めて選んだときに Worker で作る。
import * as THREE from 'three';
import { buildSpec } from '../skin/parts.js';
import { createAnatomy } from '../skin/mesh.js';
import { gradient } from '../figure.js';

// 肩をまたぐ筋（胴・肩甲帯から上腕へ）は骨の重みで動かすと腕を上げたとき板のように浮くので、
// 姿勢ごとに起始と停止を骨と一緒に動かして紡錘を張り直し、その面だけ Worker で取り出し直す
const SPAN = /^(deltoid(Front|Middle|Rear)|pectoralis(Clavicular|Sternal|Costal)|latissimusUpper|teres(Major|Minor))\.(L|R)$/;
const rowsOf = (M) => { const e = M.elements; return [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]]; };
const mat4 = (m) => new THREE.Matrix4().set(...m, 0, 0, 0, 1);

// 張り直す筋の静止形の形: 起始 A・停止 B（静止形の root 座標）、太さの向き Z、骨
function spanOf(spec) {
  return spec.parts.map((pt, i) => ({ pt, i })).filter(({ pt }) => SPAN.test(pt.id) && pt.knots?.length >= 2).map(({ pt, i }) => {
    const F = mat4(pt.m).invert(), h = pt.p[1];
    return { i, pt, A: new THREE.Vector3(0, -h, 0).applyMatrix4(F), B: new THREE.Vector3(0, h, 0).applyMatrix4(F),
      Z: new THREE.Vector3(0, 0, 1).transformDirection(F), a: spec.bones[pt.knots[0][1]], b: spec.bones[pt.knots.at(-1)[1]], len: 2 * h };
  });
}

// 姿勢を取った張り直しの筋（root 座標）を部位の形の並びにする
function posedSpans(fig, spec, spans) {
  fig.root.updateMatrixWorld(true);
  const inv = fig.root.matrixWorld.clone().invert();
  const M = (b) => inv.clone().multiply(fig.j[b].matrixWorld).multiply(spec.frames[b].clone().invert());
  const cache = {};
  const get = (b) => (cache[b] ??= M(b));
  return spans.map(({ pt, A, B, Z, a, b, len }) => {
    const A2 = A.clone().applyMatrix4(get(a)), B2 = B.clone().applyMatrix4(get(b));
    const Y = B2.clone().sub(A2), l = Y.length() || 1e-6;
    Y.divideScalar(l);
    const Zh = Z.clone().transformDirection(get(a));
    const Z2 = Zh.addScaledVector(Y, -Zh.dot(Y)).normalize();
    const X = new THREE.Vector3().crossVectors(Y, Z2);
    const F = new THREE.Matrix4().makeBasis(X, Y, Z2).setPosition(A2.clone().add(B2).multiplyScalar(0.5));
    // 伸びると細く、縮むと太く（体積をおおよそ保つ）
    const k = Math.min(1.3, Math.max(0.75, Math.sqrt(len / l)));
    const p = [pt.p[0] * k, l / 2, pt.p[2] * k, pt.p[3] ?? 0];
    const box = new THREE.Box3(new THREE.Vector3(-p[0], -p[1], -p[2]), new THREE.Vector3(p[0], p[1], p[2])).applyMatrix4(F);
    return { kind: 'ell', m: rowsOf(F.clone().invert()), p, box: [...box.min.toArray(), ...box.max.toArray()], mesh: { body: null } };
  });
}

const KEY = 'posing-kun.view';
const MODES = ['doll', 'anatomy'];
const LABEL = { doll: '人形', anatomy: '解剖' };

export default function init(ctx) {
  const { figs } = ctx;
  let mode = 'doll';
  try { if (localStorage.getItem(KEY) === 'anatomy') mode = 'anatomy'; } catch { /* 既定は人形 */ }
  const st = new Map(); // fig → { group, pending, id, body }
  let seq = 0;

  const seeThrough = (fig, on) => {
    for (const m of fig.meshes) {
      if (m.userData.proxy) continue;
      for (const c of m.children) c.visible = !on;
    }
    for (const mat of [fig.mat, fig.hiMat()]) {
      mat.transparent = on;
      mat.opacity = on ? 0.28 : 1;
      mat.depthWrite = !on;
      mat.needsUpdate = true;
    }
  };

  function build(fig) {
    const s = st.get(fig);
    s.pending = true;
    s.body = fig.b;
    s.id = ++seq;
    const spec = buildSpec(fig.who, fig.b);
    s.spec = spec;
    s.spans = spanOf(spec);
    const dyn = new Set(s.spans.map((x) => x.i));
    s.worker ??= new Worker(new URL('../skin/worker.js', import.meta.url), { type: 'module' });
    s.worker.onmessage = ({ data }) => {
      if (data.id !== s.id) return;
      s.pending = false;
      s.group?.removeFromParent();
      s.group?.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
      s.spanMesh = null;
      s.group = createAnatomy(fig, s.spec, data.meshes);
      fig.root.add(s.group);
      s.spanKey = '';
      show(fig);
    };
    // 張り直す筋は静止の面から外す（mesh を空にすると select が選ばない）
    const parts = spec.parts.map((pt, i) => (dyn.has(i) ? { ...pt, mesh: {} } : pt));
    s.worker.postMessage({ id: s.id, parts, edges: spec.edges, grids: { anatomy: spec.grids.anatomy } });
  }

  // 張り直す筋の面: 肩・鎖骨・胸の向きが変わったら Worker で取り出し直す（取り出し中に来た姿勢は最新だけ）
  const SPAN_JOINTS = ['chest', 'leftClavicle', 'rightClavicle', 'leftScapula', 'rightScapula', 'leftShoulder', 'rightShoulder'];
  function spanTick(fig) {
    const s = st.get(fig);
    if (mode !== 'anatomy' || !s.group || !s.spans?.length) return;
    fig.root.updateMatrixWorld(true);
    const key = SPAN_JOINTS.map((j) => fig.j[j].matrixWorld.elements.map((x) => x.toFixed(3)).join()).join('|');
    if (key === s.spanKey) return;
    s.spanKey = key;
    if (s.spanBusy) { s.spanPending = true; return; }
    const parts = posedSpans(fig, s.spec, s.spans);
    const edges = [];
    // 同じ側の筋どうしは筋と同じ幅の半分で結合する
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      if (s.spans[i].pt.side * s.spans[j].pt.side < 0) continue;
      const k = 0.5 * Math.min(s.spans[i].pt.k, s.spans[j].pt.k);
      edges.push([i, j, k, k, 0, 0, 0, 0]);
    }
    const box = new THREE.Box3();
    for (const p of parts) box.union(new THREE.Box3(new THREE.Vector3(...p.box.slice(0, 3)), new THREE.Vector3(...p.box.slice(3))));
    box.expandByScalar(0.03);
    const cell = 0.008, min = box.min.toArray();
    const n = box.max.toArray().map((x, i) => Math.ceil((x - min[i]) / cell) + 1);
    s.spanWorker ??= new Worker(new URL('../doll-worker.js', import.meta.url), { type: 'module' });
    s.spanBusy = true;
    s.spanWorker.onmessage = ({ data: m }) => {
      s.spanBusy = false;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
      g.setIndex(new THREE.BufferAttribute(m.index, 1));
      if (!s.spanMesh) {
        s.spanMesh = new THREE.Mesh(g, new THREE.MeshToonMaterial({ color: 0xa8564c, gradientMap: gradient }));
        s.spanMesh.raycast = () => {};
        s.spanMesh.frustumCulled = false;
      } else { s.spanMesh.geometry.dispose(); s.spanMesh.geometry = g; }
      if (s.spanMesh.parent !== s.group) s.group.add(s.spanMesh);
      if (s.spanPending) { s.spanPending = false; s.spanKey = ''; spanTick(fig); }
    };
    s.spanWorker.postMessage({ id: 0, parts, edges, grid: { min, n, cell, g: null }, clip: null });
  }
  ctx.onFrame(() => { for (const f of Object.values(figs)) spanTick(f); });

  function show(fig) {
    const s = st.get(fig);
    const on = mode === 'anatomy';
    seeThrough(fig, on);
    if (s.group) s.group.visible = on && s.body === fig.b;
    if (on && !s.pending && s.body !== fig.b) build(fig);
  }

  for (const fig of Object.values(figs)) {
    st.set(fig, { group: null, pending: false, id: 0, body: null });
    // 体型を変えたら、解剖の表示中なら作り直す
    const setBody = fig.setBody.bind(fig);
    fig.setBody = (b) => { setBody(b); show(fig); };
  }

  const btn = document.createElement('button');
  const label = () => { btn.textContent = `表示: ${LABEL[mode]}`; };
  const setMode = (m) => {
    mode = m;
    try { localStorage.setItem(KEY, mode); } catch { /* 保存できなくても動く */ }
    label();
    for (const f of Object.values(figs)) show(f);
  };
  btn.addEventListener('click', () => setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]));
  label();
  ctx.bar.append(btn);
  for (const f of Object.values(figs)) show(f);

  ctx.view = {
    get mode() { return mode; },
    set mode(m) { if (MODES.includes(m) && m !== mode) setMode(m); },
  };
}

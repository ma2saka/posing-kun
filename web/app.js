import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Figure, JOINTS, outlineUniforms } from './figure.js';
import { createOps } from './ops.js';
import { createProps } from './props.js';
import features from './features/index.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(devicePixelRatio);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);
scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(2, 4, 3);
scene.add(sun);
const grid = new THREE.GridHelper(6, 12, 0xbbbbbb, 0xdddddd);
scene.add(grid);
// 床の影（接地が分かるように）。真上の光は照明には効かせず影だけを落とす
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const shadowLight = new THREE.DirectionalLight(0xffffff, 0);
shadowLight.position.set(0.3, 6, 0.6);
shadowLight.castShadow = true;
Object.assign(shadowLight.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 12 });
shadowLight.shadow.mapSize.set(2048, 2048);
shadowLight.shadow.radius = 4;
scene.add(shadowLight);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.18 }));
floor.receiveShadow = true;
floor.position.y = -0.001;
scene.add(floor);

const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;

const figs = { female: new Figure('female'), male: new Figure('male') };
for (const f of Object.values(figs)) scene.add(f.root);
const apply = createOps(figs);
const props = createProps(scene);

const INITIAL = [
  { op: 'place', who: 'female', pos: [0.4, null, 0], rot: [0, 0, 0] },
  { op: 'place', who: 'male', pos: [-0.4, null, 0], rot: [0, 0, 0] },
  { op: 'reset', who: 'both' },
  { op: 'posture', who: 'both', chest: 0, shrug: 0, neck: 0 },
];

// ---- 状態と元に戻す
const snapshot = () => ({ ...Object.fromEntries(Object.entries(figs).map(([w, f]) => [w, f.getState()])), props: props.getState() });
const restore = (s) => {
  if (propSel) select(null);
  for (const [w, st] of Object.entries(s)) {
    if (w === 'props') props.setState(st);
    else figs[w]?.setState(st);
  }
  refreshSel();
  persist();
};
const undoStack = [];
const pushUndo = () => { undoStack.push(snapshot()); if (undoStack.length > 100) undoStack.shift(); };
const persist = () => { try { localStorage.setItem('posing-kun.scene', JSON.stringify(snapshot())); } catch { /* 保存できなくても動く */ } };
function load() {
  try {
    const s = JSON.parse(localStorage.getItem('posing-kun.scene'));
    if (s) return restore(s);
  } catch { /* 初期配置へ */ }
  apply(INITIAL);
}

// ---- カメラ
function center() {
  const c = new THREE.Vector3();
  const fs = Object.values(figs).filter((f) => f.root.visible);
  for (const f of fs) c.add(f.part('hips'));
  return fs.length ? c.multiplyScalar(1 / fs.length) : c.set(0, 1, 0);
}
const VIEWS = { front: [0, 10], high: [0, 50], low: [0, -25], side: [90, 8], diag: [40, 18] };
function setView(name) {
  const [az, el] = VIEWS[name];
  const c = center();
  c.y = Math.max(c.y, 0.5);
  const r = 4.2;
  const a = az * Math.PI / 180, e = el * Math.PI / 180;
  camera.position.set(c.x + r * Math.cos(e) * Math.sin(a), c.y + r * Math.sin(e), c.z + r * Math.cos(e) * Math.cos(a));
  orbit.target.copy(c);
  camera.up.set(0, 1, 0);
}
setView('diag');
document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.cam)));

// ---- 関節の選択とギズモ
const tc = new TransformControls(camera, canvas);
tc.setSpace('local');
tc.setSize(0.7);
scene.add(tc.getHelper());
let selected = null; // {fig, joint}
let propSel = null; // 選んだ小物（人形の選択とは同時に持たない）
const propHooks = [];
let rootMode = 'rotate';
// 小物のギズモは 移動 → 回転 → 大きさ の順に切り替える。動かすことが多いので移動から
const PROP_MODES = ['translate', 'rotate', 'scale'];
let propMode = 'translate';
tc.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
  if (e.value) pushUndo(); else persist();
});
// ギズモで回した関節も可動域に収める（範囲外のまま置くと、次に IK で引いたとき範囲内へ飛ぶ）
tc.addEventListener('objectChange', () => {
  if (propSel) {
    propSel.settle();
    for (const h of propHooks) h(propSel);
  }
  if (selected && selected.joint !== 'hips') {
    const { fig, joint } = selected;
    fig.setJoint(joint, fig.getJoint(joint));
    fig.root.updateMatrixWorld(true);
  }
  refreshSel();
});

const selectHooks = [];
// 選択・ドラッグできる人形か（表示と、もう片方を操作中かで features が決める）
let pickable = () => true;
// 指は手首として選ぶ（手首を起点に手全体を回す）
const asJoint = (j) => j?.replace(/^(left|right)(Thumb|Index|Middle|Ring|Pinky)\d$/, '$1Wrist');
function select(fig, joint) {
  joint = asJoint(joint);
  for (const h of selectHooks) h(fig);
  for (const f of Object.values(figs)) f.setTint(null);
  if (propSel) {
    propSel.setTint(false);
    propSel = null;
    for (const h of propHooks) h(null);
  }
  Object.assign(tc, { showX: true, showY: true, showZ: true });
  modeLabel();
  selected = fig ? { fig, joint } : null;
  if (!fig) { tc.detach(); refreshSel(); return; }
  fig.setTint(joint);
  tc.attach(fig.j[joint]);
  tc.setMode(joint === 'hips' ? rootMode : 'rotate');
  refreshSel();
}
// 小物は床の上の移動、縦軸の回転、大きさの変更だけ（M で切り替え）
function selectProp(p) {
  select(null);
  if (!p) return;
  propSel = p;
  p.setTint(true);
  tc.attach(p.mesh);
  propGizmo();
  for (const h of propHooks) h(p);
  refreshSel();
}
function propGizmo() {
  tc.setMode(propMode);
  modeLabel();
  Object.assign(tc, { translate: { showX: true, showY: false, showZ: true }, rotate: { showX: false, showY: true, showZ: false }, scale: { showX: true, showY: true, showZ: true } }[propMode]);
}
function refreshSel() {
  if (propSel) {
    const st = propSel.getState();
    $('sel').textContent = `${propSel.label} 幅 ${st.size[0]} 高さ ${st.size[1]} 奥行き ${st.size[2]}（M で移動/回転/大きさ）`;
    return;
  }
  if (!selected) { $('sel').textContent = '人形の部位をクリックすると関節を選択（Esc で解除）'; return; }
  const { fig, joint } = selected;
  const st = fig.getState();
  const v = joint === 'hips' ? `pos ${JSON.stringify(st.pos)} rot ${JSON.stringify(st.rot)}` : JSON.stringify(fig.getJoint(joint).map(Math.round));
  $('sel').textContent = `${fig.who}.${joint} ${v}${joint === 'hips' ? '（M で移動/回転）' : ''}`;
}
$('mode').addEventListener('click', toggleRootMode);
function toggleRootMode() {
  const flip = (m) => (m === 'rotate' ? 'translate' : 'rotate');
  if (propSel) {
    propMode = PROP_MODES[(PROP_MODES.indexOf(propMode) + 1) % PROP_MODES.length];
    propGizmo();
    return;
  }
  rootMode = flip(rootMode);
  modeLabel();
  if (selected?.joint === 'hips') tc.setMode(rootMode);
}
// ボタンは今選んでいるもの（小物か人形の腰）の切り替えを示す
function modeLabel() {
  const m = propSel ? propMode : rootMode;
  $('mode').textContent = `ギズモ: ${{ rotate: '回転', translate: '移動', scale: '大きさ' }[m]}`;
}

const ray = new THREE.Raycaster();
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 || tc.dragging) return;
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = ray.intersectObjects([...Object.values(figs).filter((f) => pickable(f)).flatMap((f) => f.meshes), ...props.meshes()], false)[0];
  if (hit?.object.userData.prop) selectProp(hit.object.userData.prop);
  else if (hit) select(hit.object.userData.fig, hit.object.userData.joint);
  else if (!tc.axis) select(null);
});
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLTextAreaElement) return;
  if (e.key === 'Escape') select(null);
  if (e.key === 'm') toggleRootMode();
  if (e.key === 'z' && (e.ctrlKey || e.metaKey)) undo();
});

// ---- ボタン
function undo() { const s = undoStack.pop(); if (s) restore(s); }
$('undo').addEventListener('click', undo);
$('reset').addEventListener('click', () => { pushUndo(); apply(INITIAL); select(null); persist(); setView('diag'); });
$('save').addEventListener('click', () => download('posing-kun.json', new Blob([JSON.stringify(snapshot(), null, 1)], { type: 'application/json' })));
$('load').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async (e) => { pushUndo(); restore(JSON.parse(await e.target.files[0].text())); e.target.value = ''; });
$('png').addEventListener('click', () => {
  const helpers = [grid, tc.getHelper()];
  helpers.forEach((h) => { h.visible = false; });
  render();
  canvas.toBlob((b) => download('posing-kun.png', b));
  helpers.forEach((h) => { h.visible = true; });
});
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- 描画
function resize() {
  const { clientWidth: w, clientHeight: h } = canvas.parentElement;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  outlineUniforms.uRes.value.set(w * devicePixelRatio, h * devicePixelRatio);
  outlineUniforms.uPx.value = 1.6 * devicePixelRatio;
}
new ResizeObserver(resize).observe(canvas.parentElement);
// ---- 機能の差し込み
let render = () => renderer.render(scene, camera);
const frameHooks = [], afterHooks = [];
const ctx = {
  THREE, scene, camera, renderer, canvas, orbit, tc, figs, apply, props, selectProp,
  getSelectedProp: () => propSel,
  onPropSelect(fn) { propHooks.push(fn); },
  bar: $('barView'), panel: $('panel'),
  pushUndo, persist, refreshSel, select, setView, getSelected: () => selected,
  onSelect(fn) { selectHooks.push(fn); },
  get pickable() { return pickable; },
  set pickable(fn) { pickable = fn; },
  setRender(fn) { render = fn; },
  onFrame(fn) { frameHooks.push(fn); },
  afterRender(fn) { afterHooks.push(fn); },
};
for (const init of features) init(ctx);
load();
setView('diag');

renderer.setAnimationLoop(() => {
  orbit.update();
  for (const f of Object.values(figs)) f.root.traverse((o) => { if (o.isMesh) o.castShadow = !o.material.isShaderMaterial; });
  for (const f of frameHooks) f();
  render();
  for (const f of afterHooks) f();
});

window.pp = { figs, apply, snapshot, setView, JOINTS, ctx };

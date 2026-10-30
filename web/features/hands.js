// 手の形: 形の名前と握り具合で指の関節を決める。人形ごとの状態は stateHooks の 'hands' で保存する。
import { Figure } from '../figure.js';
import { OPEN, poseHand } from '../hands.js';
import { makeHeld } from '../held.js';

const FIST = [88, 100, 60];
// 指 [付け根, 第 2, 第 1 関節, 開き]、親指 [離す, 前へ回す, 付け根, 中, 先]
export const SHAPES = {
  open: { label: 'パー', ...OPEN },
  relaxed: {
    label: '自然', thumb: [35, 30, 0, 10, 15],
    index: [12, 22, 12, 3], middle: [18, 28, 14, 0], ring: [24, 30, 15, -2], pinky: [30, 32, 16, -5],
  },
  fist: {
    label: 'グー', thumb: [40, 80, 0, 10, 55],
    index: [...FIST, 0], middle: [...FIST, 0], ring: [...FIST, 0], pinky: [...FIST, -2],
  },
  point: {
    label: '指差し', thumb: [40, 80, 0, 10, 55],
    index: [0, 0, 0, 3], middle: [...FIST, 0], ring: [...FIST, 0], pinky: [...FIST, -2],
  },
  thumbsup: {
    label: 'サムアップ', thumb: [12, 0, 0, 0, 0],
    index: [...FIST, 0], middle: [...FIST, 0], ring: [...FIST, 0], pinky: [...FIST, -2],
  },
  // 手を開いたまま中指と薬指をそろえて付け根から直角に折る
  fox: {
    label: '狐', thumb: [50, 10, 0, 0, 0],
    index: [0, 0, 0, 12], middle: [90, 0, 0, -2], ring: [90, 0, 0, 3], pinky: [0, 0, 0, -16],
  },
  peace: {
    label: 'チョキ', thumb: [44, 96, 0, 10, 42],
    index: [0, 0, 0, 12], middle: [0, 0, 0, -6], ring: [...FIST, -2], pinky: [...FIST, -4],
  },
  grip: {
    label: '握る', thumb: [48, 80, 0, 5, 45],
    index: [45, 60, 40, 2], middle: [45, 60, 40, 0], ring: [45, 60, 40, -2], pinky: [45, 60, 40, -4],
  },
  pinch: {
    label: 'つまむ', thumb: [40, 68, 0, 5, 5],
    index: [40, 55, 30, 0], middle: [35, 50, 30, -2], ring: [45, 50, 25, -4], pinky: [55, 45, 25, -8],
  },
  flat: {
    label: '手をつく', thumb: [20, 0, 0, 0, 0],
    index: [0, 0, 0, 1], middle: [0, 0, 0, 0], ring: [0, 0, 0, -1], pinky: [0, 0, 0, -2],
  },
  // held: 手に持たせる物（held.js）
  ball: {
    label: 'ボールを握る', held: 'ball', thumb: [55, 70, 0, 10, 15],
    index: [35, 40, 30, 12], middle: [35, 40, 30, 2], ring: [35, 40, 30, -8], pinky: [35, 40, 30, -16],
  },
  gun: {
    label: '銃を握る', held: 'gun', thumb: [40, 60, 0, 10, 20],
    index: [40, 45, 15, 0], middle: [75, 85, 40, 0], ring: [75, 85, 40, -2], pinky: [75, 85, 40, -4],
  },
  claw: {
    label: '爪を立てる', thumb: [45, 35, 0, 30, 45],
    index: [15, 75, 55, 10], middle: [15, 75, 55, 2], ring: [15, 75, 55, -5], pinky: [15, 75, 55, -12],
  },
};

const ALIAS = new Map([
  ...Object.entries(SHAPES).flatMap(([k, v]) => [[k, k], [v.label, k]]),
  ...Object.entries({
    paper: 'open', relax: 'relaxed', natural: 'relaxed', rock: 'fist', pointing: 'point', scissors: 'peace', v: 'peace',
    hold: 'grip', ボール: 'ball', 銃: 'gun', pistol: 'gun', ピストル: 'gun', ぐー: 'fist', ぱー: 'open', ちょき: 'peace', ピース: 'peace', 握り拳: 'fist', 拳: 'fist', こぶし: 'fist',
    げんこつ: 'fist', 開く: 'open', 握り: 'grip', つまみ: 'pinch', 爪: 'claw',
    thumbs_up: 'thumbsup', good: 'thumbsup', いいね: 'thumbsup', グッド: 'thumbsup', 親指を立てる: 'thumbsup', キツネ: 'fox', きつね: 'fox', 狐のかたち: 'fox', 人差し指: 'point', 指さし: 'point',
  }),
]);
const parseShape = (x) => {
  const k = ALIAS.get(String(x).trim().toLowerCase());
  if (!k) throw new Error(`unknown hand shape: ${x}（${Object.keys(SHAPES).join('|')}）`);
  return k;
};
// 0〜1。2〜100 の整数は百分率として読む
const parseAmount = (x) => {
  if (x == null) return 1;
  const v = Number(x);
  if (Number.isInteger(v) && v > 1 && v <= 100) return v / 100;
  if (!(v >= 0 && v <= 1)) throw new Error(`amount は 0〜1: ${x}`);
  return v;
};
// 保存データの手。読めない値は自然な手にする
const parseHand = (v) => {
  try { return { shape: parseShape(v?.shape ?? 'relaxed'), amount: parseAmount(v?.amount) }; } catch { return { shape: 'relaxed', amount: 1 }; }
};

const BOTH = ['left', 'right'];
const SIDES = new Map(Object.entries({ left: ['left'], right: ['right'], both: BOTH, 左: ['left'], 右: ['right'], 両方: BOTH, 両手: BOTH }));
const sides = (h) => {
  const v = SIDES.get(h);
  if (!v) throw new Error(`hand は left|right|both: ${h}`);
  return v;
};

const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const blend = ({ shape, amount }) => Object.fromEntries(['thumb', 'index', 'middle', 'ring', 'pinky']
  .map((f) => [f, lerp(OPEN[f], SHAPES[shape][f], amount)]));

const html = `<legend>手の形</legend>
<label>人形 <select data-k="who"><option value="female">女性</option><option value="male">男性</option></select></label>
<label>手 <select data-k="hand"><option value="both">両方</option><option value="left">左</option><option value="right">右</option></select></label>
<label>形 <select data-k="shape">${Object.entries(SHAPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
<label>握り具合 <input data-k="amount" type="range" min="0" max="100"></label>`;

export default function init({ figs, apply, panel, pushUndo, persist, camera, canvas, getSelected, onFrame, tc }) {
  const state = new Map();
  const relaxed = { shape: 'relaxed', amount: 1 };
  const get = (fig) => state.get(fig) ?? { left: relaxed, right: relaxed };
  // 持たせた物は手首の Group の子。体型を変えると骨が作り直されるので、そのたびに作り直す
  const held = new Map(); // fig → { left, right: { kind, wrist, group } }
  function hold(fig, side, kind) {
    const per = held.get(fig) ?? {};
    held.set(fig, per);
    const wrist = fig.j[`${side}Wrist`], cur = per[side];
    if (!cur && !kind) return;
    if (cur?.kind === kind && cur.wrist === wrist && cur.k === fig.b.hand) return;
    cur?.group.removeFromParent();
    per[side] = null;
    if (!kind) return;
    const group = makeHeld(kind, side, fig.b.hand);
    wrist.add(group);
    per[side] = { kind, wrist, group, k: fig.b.hand };
  }
  function setHand(fig, side, h) {
    const P = blend(h);
    state.set(fig, { ...get(fig), [side]: h });
    poseHand(fig, side, P);
    hold(fig, side, SHAPES[h.shape].held);
    fig.root.updateMatrixWorld(true);
  }
  // 床についている人形は指を伸ばしても床につけたままにする
  const minY = (fig) => fig.box().min.y;
  function keepGround(fs, fn) {
    const grounded = fs.filter((f) => Math.abs(minY(f)) < 1e-3);
    fn();
    for (const f of grounded) f.ground();
  }

  const box = document.createElement('fieldset');
  box.innerHTML = html;
  panel.append(box);
  const el = Object.fromEntries([...box.querySelectorAll('[data-k]')].map((e) => [e.dataset.k, e]));
  const sync = () => {
    if (target) label();
    const h = get(figs[el.who.value])[el.hand.value === 'right' ? 'right' : 'left'];
    el.shape.value = h.shape;
    el.amount.value = Math.round(h.amount * 100);
  };
  const fromUI = () => {
    const f = figs[el.who.value];
    keepGround([f], () => { for (const s of sides(el.hand.value)) setHand(f, s, { shape: el.shape.value, amount: el.amount.value / 100 }); });
  };
  // スライダーの操作は、つかむかフォーカスが外れるまでを一回の取り消し単位にする
  let armed = false;
  const begin = () => { if (!armed) pushUndo(); armed = true; };
  const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
  el.who.addEventListener('change', sync);
  el.hand.addEventListener('change', sync);
  el.shape.addEventListener('change', () => { armed = false; pushUndo(); el.amount.value = 100; fromUI(); persist(); });
  el.amount.addEventListener('pointerdown', () => { armed = false; begin(); });
  el.amount.addEventListener('keydown', (e) => { if (KEYS.has(e.key)) begin(); });
  el.amount.addEventListener('blur', () => { armed = false; });
  el.amount.addEventListener('input', fromUI);
  el.amount.addEventListener('change', persist);

  // 手のひらを選ぶと手の近くに切り替えボタンを出す。押すたびに次の形へ
  const ORDER = Object.keys(SHAPES);
  const cycle = document.createElement('button');
  cycle.title = '手の形を切り替える';
  cycle.style.cssText = 'position:absolute;display:none;padding:1px 6px;font-size:12px;white-space:nowrap;transform:translate(-50%,-50%);z-index:2';
  canvas.parentElement.append(cycle);
  let target = null; // [fig, side]
  const label = () => { cycle.textContent = `↻ ${SHAPES[get(target[0])[target[1]].shape].label}`; };
  cycle.addEventListener('click', () => {
    const [f, side] = target;
    const next = ORDER[(ORDER.indexOf(get(f)[side].shape) + 1) % ORDER.length];
    pushUndo();
    keepGround([f], () => setHand(f, side, { shape: next, amount: 1 }));
    el.who.value = f.who;
    el.hand.value = side;
    sync();
    label();
    persist();
  });
  const P = new camera.position.constructor();
  onFrame(() => {
    const sel = getSelected();
    const m = /^(left|right)Wrist$/.exec(sel?.joint ?? '');
    if (!m) { cycle.style.display = 'none'; target = null; return; }
    const side = m[1];
    if (target?.[0] !== sel.fig || target[1] !== side) { target = [sel.fig, side]; label(); }
    // 手首のギズモ（回転の輪）の外側、手首から指先の向きに置く
    const wp = sel.fig.j[`${side}Wrist`].getWorldPosition(P);
    const dist = wp.distanceTo(camera.position);
    const tanH = Math.tan(camera.fov * Math.PI / 360);
    const ring = 0.8 * dist * Math.min(1.9 * tanH / camera.zoom, 7) / 4 * tc.size; // 外側の輪の半径（m）
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const ringPx = ring / (2 * dist * tanH) * h;
    const palm = sel.fig.part(`${side}Hand`).project(camera);
    const wrist = wp.project(camera);
    const x = (wrist.x + 1) / 2 * w, y = (1 - wrist.y) / 2 * h;
    let dx = palm.x - wrist.x, dy = wrist.y - palm.y;
    const len = Math.hypot(dx * w, dy * h) || 1;
    dx = dx * w / len; dy = dy * h / len;
    const r = ringPx + 18 + cycle.offsetWidth / 2;
    cycle.style.left = `${x + dx * r - cycle.offsetWidth / 2}px`;
    cycle.style.top = `${y + dy * r - cycle.offsetHeight / 2}px`;
    cycle.style.display = palm.z < 1 ? '' : 'none';
  });

  Figure.stateHooks.push({
    key: 'hands',
    get: (fig) => structuredClone(get(fig)),
    set(fig, v) {
      for (const s of BOTH) if (v?.[s]) setHand(fig, s, parseHand(v[s]));
      sync();
    },
  });
  for (const f of Object.values(figs)) for (const s of BOTH) setHand(f, s, relaxed);
  sync();

  const whos = (who) => {
    const ws = who === 'both' ? Object.keys(figs) : [who];
    for (const w of ws) if (!Object.hasOwn(figs, w)) throw new Error(`who は female|male|both: ${who}`);
    return ws.map((w) => figs[w]);
  };
  apply.handlers.hand = ({ who = 'both', hand = 'both', shape, amount }) => {
    const h = { shape: parseShape(shape), amount: parseAmount(amount) };
    const fs = whos(who), ss = sides(hand);
    keepGround(fs, () => { for (const f of fs) for (const s of ss) setHand(f, s, h); });
    sync();
  };
  const reset = apply.handlers.reset;
  apply.handlers.reset = (op) => {
    reset(op);
    for (const f of whos(op.who ?? 'both')) for (const s of BOTH) setHand(f, s, relaxed);
    sync();
  };

}

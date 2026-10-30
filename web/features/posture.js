// 姿勢: 胸を開く ⟷ 背を丸める、肩をすくめる、首を前へ出す。人形ごとに fig.posture へ持ち、関節の値には上乗せとして入る。
// 肩甲上腕リズム（腕を上げると鎖骨・肩甲骨も動く）の入り切りもここ。
import { Figure } from '../figure.js';

const KEYS = [['chest', '背を丸める ⟷ 胸を開く', -1, 1], ['shrug', '肩をすくめる', 0, 1], ['neck', '首を前に出す', 0, 1]];
const RHYTHM = 'posing-kun.posture.rhythm';

export default function init(ctx) {
  const { figs, apply } = ctx;
  const ui = {};
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  const set = (fig, p) => {
    fig.setPosture(p);
    ui[fig.who]?.();
  };
  Figure.stateHooks.push({ key: 'posture', get: (fig) => ({ ...fig.posture }), set });

  apply.handlers.posture = ({ who, ...rest }) => {
    const ws = who === 'both' ? Object.keys(figs) : [who];
    const notes = [];
    for (const w of ws) {
      const f = figs[w];
      if (!f) throw new Error(`who は female か male か both: ${who}`);
      const p = { ...f.posture };
      for (const [k, , lo, hi] of KEYS) {
        if (rest[k] == null) continue;
        const x = Number(rest[k]);
        if (!Number.isFinite(x)) { notes.push(`${k} は数値`); continue; }
        p[k] = clamp(x, lo, hi);
      }
      set(f, p);
    }
    return notes.join('、') || null;
  };

  // ---- UI
  const fs = document.createElement('fieldset');
  fs.innerHTML = '<legend>姿勢</legend>';
  const rh = document.createElement('input');
  rh.type = 'checkbox';
  let on = true;
  try { on = localStorage.getItem(RHYTHM) !== '0'; } catch { /* 既定は連動 */ }
  const setRhythm = (v) => {
    on = v;
    rh.checked = v;
    for (const f of Object.values(figs)) { f.rhythm = v; f.root.updateMatrixWorld(true); }
    try { localStorage.setItem(RHYTHM, v ? '1' : '0'); } catch { /* 保存できなくても動く */ }
  };
  rh.addEventListener('change', () => setRhythm(rh.checked));
  const rl = document.createElement('label');
  rl.append('肩甲骨の連動', rh);
  fs.append(rl);
  setRhythm(on);
  const boxes = {};

  for (const [who, fig] of Object.entries(figs)) {
    const box = document.createElement('div');
    boxes[who] = box;
    const sliders = {};
    for (const [k, name, lo, hi] of KEYS) {
      const out = document.createElement('span');
      const r = Object.assign(document.createElement('input'), { type: 'range', min: lo, max: hi, step: 0.05, value: 0 });
      r.dataset.who = who;
      r.dataset.key = k;
      let dragging = false;
      r.addEventListener('input', () => {
        if (!dragging) { ctx.pushUndo(); dragging = true; }
        set(fig, { ...fig.posture, [k]: +r.value });
        ctx.refreshSel();
      });
      r.addEventListener('change', () => { dragging = false; ctx.persist(); });
      const n = document.createElement('span');
      n.append(`${name} `, out);
      const l = document.createElement('label');
      l.append(n, r);
      box.append(l);
      sliders[k] = [r, out];
    }
    ui[who] = () => {
      for (const [k, [r, out]] of Object.entries(sliders)) { r.value = fig.posture[k]; out.textContent = (+fig.posture[k]).toFixed(2); }
    };
    ui[who]();
    fs.append(box);
  }
  const show = (w) => { for (const [k, b] of Object.entries(boxes)) b.hidden = k !== w; };
  ctx.onWho(show);
  show(ctx.who);
  ctx.panel.append(fs);
}

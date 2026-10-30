// 体型: プリセットと倍率から BODY と同じ形の値を作り、Figure.setBody で組み直す。
// 皮膚（skin/anatomy.js）が使うのは 骨格の幅（sw 肩幅・hw 腰幅・scale 身長・手足の長さ）、muscle 筋の量、fat 脂肪の量、bust 胸。
// chest/waist/pelvis/r は部品の体（選択と床の判定、部品の表示）のための近似で、筋と脂肪の倍率から作る。
import { BODY, Figure } from '../figure.js';

// BODY に掛ける倍率。muscle/fat は筋と脂肪の量、chest/waist/pelvis は [幅, 高さ, 厚み]、r は部位ごとの太さ、arm/leg は長さ
export const PRESETS = {
  female: {
    標準: {},
    スレンダー: {
      scale: 1.01, leg: 1.03, thick: 0.86, sw: 0.97, hw: 0.94, muscle: 0.9, fat: 0.55,
      chest: [0.95, 1, 0.92], waist: [0.9, 1, 0.9], pelvis: [0.94, 1, 0.92], bust: 0.8,
    },
    グラマー: {
      sw: 1.02, hw: 1.08, muscle: 1, fat: 1.45, chest: [1.04, 1, 1.04], waist: [0.92, 1, 0.94], pelvis: [1.12, 1.03, 1.1],
      r: { ua: 1.06, fa: 1.03, th: 1.14, sh: 1.06 }, bust: 1.35,
    },
    小柄: {
      scale: 0.89, leg: 0.94, arm: 0.96, thick: 0.97, sw: 0.96, hw: 0.97, bust: 0.88, hand: 0.95, muscle: 0.95, fat: 0.95,
    },
    長身: {
      scale: 1.04, leg: 1.07, arm: 1.04, sw: 1.04, thick: 0.96, chest: [1, 1, 0.96], bust: 0.92, muscle: 1.02, fat: 0.85,
    },
  },
  male: {
    標準: {},
    細身: {
      leg: 1.02, thick: 0.84, sw: 0.93, hw: 0.95, muscle: 0.75, fat: 0.5,
      chest: [0.92, 1, 0.88], waist: [0.92, 1, 0.9], r: { neck: 0.92 },
    },
    がっしり: {
      scale: 0.98, leg: 0.97, thick: 1.15, sw: 1.1, hw: 1.06, muscle: 1.2, fat: 1.5,
      chest: [1.12, 1.02, 1.1], waist: [1.14, 1, 1.12], pelvis: [1.08, 1, 1.06], r: { neck: 1.18 }, hand: 1.08,
    },
    筋肉質: {
      sw: 1.12, muscle: 1.5, fat: 0.45, chest: [1.16, 1.04, 1.16], waist: [0.98, 1, 1], pelvis: [1, 1, 1.02],
      r: { ua: 1.3, fa: 1.18, th: 1.18, sh: 1.15, neck: 1.25 }, hand: 1.04,
    },
    ぽっちゃり: {
      sw: 1.03, hw: 1.1, thick: 1.12, muscle: 1, fat: 2.2, chest: [1.1, 1.04, 1.18], waist: [1.28, 1.22, 1.45], pelvis: [1.16, 1.12, 1.2],
      r: { ua: 1.08, fa: 1.04, th: 1.2, neck: 1.12 },
    },
  },
};

// 利用者がプリセットの上から掛ける倍率。[キー, 表示名, 最小, 最大]
const ADJUST = [
  ['height', '身長', 0.85, 1.15],
  ['shoulder', '肩幅', 0.85, 1.2],
  ['hip', '腰幅', 0.85, 1.2],
  ['muscle', '筋肉', 0.6, 1.6],
  ['fat', '脂肪', 0.3, 2.2],
  ['bust', '胸', 0, 1.4],
  // 胸の左右の間隔と外向き（1 が標準）
  ['bustSpread', '胸の広がり', 0.5, 1.8],
];
// 以前の「太さ」。筋肉と脂肪の両方に同じ値を掛ける（古い保存状態と操作の互換）
const LEGACY_THICK = 'thick';
const keysOf = (who) => ADJUST.filter(([k]) => !k.startsWith('bust') || BODY[who].bust);
const LABEL = { female: '女性', male: '男性' };

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const mul = (v, k) => v.map((x, i) => x * (Array.isArray(k) ? k[i] : k));

// {preset, adjust} を正規化する。範囲外は丸め、知らない値は既定に戻す
function parse(who, v) {
  if (typeof v !== 'object' || v === null) v = {};
  const preset = v.preset in PRESETS[who] ? v.preset : '標準';
  const adjust = {};
  const thick = v.adjust?.[LEGACY_THICK];
  for (const [k, , lo, hi] of keysOf(who)) {
    const x = Number(v.adjust?.[k] ?? ((k === 'muscle' || k === 'fat') && thick != null ? thick : 1));
    adjust[k] = Number.isFinite(x) ? +clamp(x, lo, hi).toFixed(2) : 1;
  }
  return { preset, adjust };
}

export function makeBody(who, { preset, adjust: a }) {
  const B = BODY[who];
  const p = PRESETS[who][preset];
  const muscle = (p.muscle ?? 1) * a.muscle, fat = (p.fat ?? 1) * a.fat;
  // 部品の体の太さは筋と脂肪から近似する
  const at = a.muscle ** 0.45 * a.fat ** 0.3;
  const t = (p.thick ?? 1) * at;
  // 肘・膝の太さは先の部位に合わせ、継ぎ目に段を作らない
  const m = (k) => (p.r?.[k] ?? 1) * t;
  const r = (k, next = k) => mul(B.r[k], [m(k), m(next)]);
  // 胴は倍率を弱めて掛け、横に広げた分だけ高さも足して円盤状にしない
  const ta = at ** 0.6;
  const torso = (k, w = 1) => {
    const s = (w * ta) ** 0.4;
    return mul(B[k], mul(p[k] ?? [1, 1, 1], [w * ta * (p.thick ?? 1), s, ta * (p.thick ?? 1)]));
  };
  return {
    ...B,
    scale: B.scale * (p.scale ?? 1) * a.height,
    sw: B.sw * (p.sw ?? 1) * a.shoulder,
    hw: B.hw * (p.hw ?? 1) * a.hip,
    ua: B.ua * (p.arm ?? 1), fa: B.fa * (p.arm ?? 1),
    th: B.th * (p.leg ?? 1), sh: B.sh * (p.leg ?? 1),
    chest: torso('chest', 1 + (a.shoulder - 1) * 0.6),
    waist: torso('waist', 1 + (a.hip - 1) * 0.3),
    pelvis: torso('pelvis', 1 + (a.hip - 1) * 0.8),
    r: { ua: r('ua', 'fa'), fa: r('fa'), th: r('th', 'sh'), sh: r('sh'), neck: B.r.neck * (p.r?.neck ?? 1) * Math.sqrt(t) },
    hand: B.hand * (p.hand ?? 1),
    bust: B.bust && +((p.bust ?? 1) * a.bust ** 0.6).toFixed(3),
    bustSpread: a.bustSpread ?? 1,
    muscle: +muscle.toFixed(3), fat: +fat.toFixed(3),
  };
}

const current = (fig) => structuredClone(fig.bodyType ?? parse(fig.who));

const minY = (fig) => fig.box().min.y;

export default function init(ctx) {
  const { figs, apply } = ctx;
  const ui = {};

  // 体型を差し替える。同じ値なら何もしない（setBody → setState → この関数、の再帰を止める）
  function setType(fig, v, ground) {
    const n = parse(fig.who, v);
    if (JSON.stringify(n) === JSON.stringify(current(fig))) return false;
    const was = ground && Math.abs(minY(fig)) < 0.015;
    fig.bodyType = n;
    fig.setBody(makeBody(fig.who, n));
    if (was) fig.ground();
    const sel = ctx.getSelected();
    if (sel?.fig === fig) ctx.select(fig, sel.joint);
    ui[fig.who]?.(n);
    return true;
  }

  Figure.stateHooks.push({ key: 'body', get: current, set: (fig, v) => setType(fig, v, false) });

  // 全員分を検査してから適用する。who:'both' で片方だけ変わることはない
  apply.handlers.body = ({ op, who, preset, ...rest }) => {
    const ws = who === 'both' ? Object.keys(figs) : [who];
    const notes = [];
    if (rest[LEGACY_THICK] != null) {
      for (const k of ['muscle', 'fat']) rest[k] ??= rest[LEGACY_THICK];
      delete rest[LEGACY_THICK];
    }
    const known = new Set(ADJUST.map(([k]) => k));
    for (const k of Object.keys(rest)) if (!known.has(k)) notes.push(`${k} は使えない`);
    const plan = ws.map((w) => {
      const f = figs[w];
      if (!f) throw new Error(`who は female か male か both: ${who}`);
      if (preset != null && !(preset in PRESETS[w])) throw new Error(`${w} の preset は ${Object.keys(PRESETS[w]).join('|')}: ${preset}`);
      const c = current(f);
      const adjust = { ...c.adjust };
      const ks = keysOf(w).map(([k]) => k);
      for (const k of known) {
        if (rest[k] != null && !ks.includes(k) && who !== 'both') notes.push(`${w} に ${k} は無い`);
      }
      for (const [k, , lo, hi] of keysOf(w)) {
        if (rest[k] == null) continue;
        const x = typeof rest[k] === 'number' ? rest[k] : typeof rest[k] === 'string' && rest[k].trim() ? Number(rest[k]) : NaN;
        if (!Number.isFinite(x)) { notes.push(`${w}.${k} は数値で指定する（${JSON.stringify(rest[k])} は無視）`); continue; }
        adjust[k] = x;
        if (x < lo || x > hi) notes.push(`${w}.${k} は ${lo}〜${hi} に丸めた`);
      }
      return [f, { preset: preset ?? c.preset, adjust }];
    });
    for (const [f, v] of plan) setType(f, v, true);
    return notes.join('、') || null;
  };


  const fs = document.createElement('fieldset');
  fs.innerHTML = '<legend>体型</legend>';
  for (const [who, fig] of Object.entries(figs)) {
    const box = document.createElement('div');
    box.style.cssText = 'border-top: 1px solid #ddd; padding-top: 4px; margin-top: 4px;';
    const sel = document.createElement('select');
    sel.dataset.who = who;
    sel.innerHTML = Object.keys(PRESETS[who]).map((n) => `<option>${n}</option>`).join('');
    const head = document.createElement('label');
    head.append(LABEL[who], sel);
    box.append(head);
    sel.addEventListener('change', () => {
      ctx.pushUndo();
      setType(fig, { preset: sel.value, adjust: current(fig).adjust }, true);
      ctx.persist();
      ctx.refreshSel();
    });

    const sliders = {};
    for (const [k, name, lo, hi] of keysOf(who)) {
      const out = document.createElement('span');
      const r = Object.assign(document.createElement('input'), { type: 'range', min: lo, max: hi, step: 0.01, value: 1 });
      r.dataset.who = who;
      r.dataset.key = k;
      let dragging = false;
      r.addEventListener('input', () => {
        if (!dragging) { ctx.pushUndo(); dragging = true; }
        const c = current(fig);
        setType(fig, { ...c, adjust: { ...c.adjust, [k]: +r.value } }, true);
        ctx.refreshSel();
      });
      r.addEventListener('change', () => { dragging = false; ctx.persist(); });
      const name_ = document.createElement('span');
      name_.append(`${name} `, out);
      const l = document.createElement('label');
      l.append(name_, r);
      box.append(l);
      sliders[k] = [r, out];
    }
    ui[who] = ({ preset, adjust }) => {
      sel.value = preset;
      for (const [k, [r, out]] of Object.entries(sliders)) { r.value = adjust[k]; out.textContent = adjust[k].toFixed(2); }
    };
    ui[who](current(fig));
    fs.append(box);
  }
  ctx.panel.append(fs);
}

// 人形の表示と、操作中の人形への絞り込み。片方を選ぶかハンドルをドラッグすると、もう片方は灰色の半透明になり選べなくなる。
// 何もない所をクリックするか Esc で解く。
const LABEL = { female: '女性', male: '男性' };
const GHOST = { opacity: 0.22, color: 0x9a9a9a };

export default function init(ctx) {
  const { figs, THREE } = ctx;
  let focus = null;
  const ghosted = (f) => focus !== null && focus !== f;
  ctx.pickable = (f) => f.root.visible && !ghosted(f);
  ctx.focus = (f) => { focus = f ?? null; };
  ctx.onSelect((f) => { focus = f ?? null; });

  // 色と透明度を灰色の半透明へ（元の値は material に控える）。輪郭は隠す
  const gray = new THREE.Color(GHOST.color);
  function ghost(obj, on) {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (m.isShaderMaterial) {
        if (on && o.userData.ghostVis === undefined) { o.userData.ghostVis = o.visible; o.visible = false; }
        if (!on && o.userData.ghostVis !== undefined) { o.visible = o.userData.ghostVis; delete o.userData.ghostVis; }
        return;
      }
      for (const m of [].concat(o.material)) {
        if (!m.color || !!m.userData.ghost === on) continue;
        if (on) {
          m.userData.ghost = { color: m.color.clone(), opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
          m.color.copy(gray);
          Object.assign(m, { opacity: Math.min(m.opacity, GHOST.opacity), transparent: true, depthWrite: false });
        } else {
          const g = m.userData.ghost;
          m.color.copy(g.color);
          Object.assign(m, { opacity: g.opacity, transparent: g.transparent, depthWrite: g.depthWrite });
          delete m.userData.ghost;
        }
        m.needsUpdate = true;
      }
    });
  }
  // 皮膚の作り直しや表示の切り替えで material が替わるので毎フレーム合わせる
  ctx.onFrame(() => { for (const f of Object.values(figs)) ghost(f.root, ghosted(f) && f.root.visible); });

  const fs = document.createElement('fieldset');
  fs.innerHTML = '<legend>人形</legend>';
  // 表示する人形は覚えておく。初めは男性だけ
  const KEY = 'posing-kun.visible';
  let shown = { female: false, male: true };
  try { shown = { ...shown, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* 初めの表示 */ }
  for (const [who, f] of Object.entries(figs)) {
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: shown[who] ?? true });
    box.dataset.who = who;
    f.root.visible = box.checked;
    box.addEventListener('change', () => {
      f.root.visible = box.checked;
      shown[who] = box.checked;
      try { localStorage.setItem(KEY, JSON.stringify(shown)); } catch { /* 保存できなくても動く */ }
      if (!box.checked && (focus === f || ctx.getSelected()?.fig === f)) ctx.select(null);
    });
    const l = document.createElement('label');
    l.append(`${LABEL[who] ?? who}を表示`, box);
    fs.append(l);
  }
  const note = document.createElement('div');
  note.style.cssText = 'color:#666;font-size:12px';
  note.textContent = '片方を選ぶと、もう片方は灰色になり選べない（何もない所をクリックか Esc で解除）';
  fs.append(note);
  ctx.panel.prepend(fs);
}

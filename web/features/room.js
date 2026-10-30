// 小物の欄: 壁と箱を置き、選んだものの大きさを変える・消す
import { KINDS } from '../props.js';

const DIMS = [['幅', 0.05, 8], ['高さ', 0.05, 4], ['奥行き', 0.02, 8]];

export default function init(ctx) {
  const { props, pushUndo, persist, selectProp } = ctx;
  const fs = document.createElement('fieldset');
  fs.innerHTML = '<legend>小物</legend>';
  const adds = document.createElement('div');
  for (const [kind, k] of Object.entries(KINDS)) {
    const b = document.createElement('button');
    b.textContent = `${k.label}を追加`;
    b.addEventListener('click', () => {
      pushUndo();
      selectProp(props.add(kind));
      persist();
    });
    adds.append(b);
  }
  fs.append(adds);

  const edit = document.createElement('div');
  const inputs = DIMS.map(([name, min, max], i) => {
    const label = document.createElement('label');
    label.textContent = name;
    const input = Object.assign(document.createElement('input'), { type: 'number', min, max, step: 0.05 });
    input.addEventListener('focus', pushUndo);
    input.addEventListener('input', () => {
      const p = ctx.getSelectedProp(), v = Number(input.value);
      if (!p || !(v >= min && v <= max)) return;
      const size = p.size;
      size[i] = v;
      p.set({ size });
      ctx.refreshSel();
      persist();
    });
    label.append(input);
    edit.append(label);
    return input;
  });
  const del = document.createElement('button');
  del.textContent = '削除';
  edit.append(del);
  fs.append(edit);
  ctx.panel.append(fs);

  const remove = () => {
    const p = ctx.getSelectedProp();
    if (!p) return;
    pushUndo();
    selectProp(null);
    props.remove(p);
    persist();
  };
  del.addEventListener('click', remove);
  addEventListener('keydown', (e) => {
    if (e.key === 'Delete' && !(e.target instanceof HTMLInputElement)) remove();
  });

  const show = (p) => {
    edit.hidden = !p;
    if (p) p.size.forEach((v, i) => { inputs[i].value = String(Math.round(v * 100) / 100); });
  };
  ctx.onPropSelect(show);
  show(null);
}

// エージェント向けの道具（WebMCP）。document.modelContext があれば登録し、無くても window.posingKun.call(name, input) で同じものを呼べる。
// 道具はどれも操作列（apply）や画面の操作と同じ経路で動かし、元に戻すと自動保存に乗る。
import { AXES, JOINTS, LIMITS, PARTS } from '../figure.js';
import { PRESETS as POSES } from '../ops.js';
import { PRESETS as BODIES } from './body.js';
import { SHAPES } from './hands.js';
import { KINDS } from '../props.js';

const D2R = Math.PI / 180;
const WHO = { type: 'string', enum: ['female', 'male'], description: '人形。female は女性、male は男性' };
const WHO_BOTH = { type: 'string', enum: ['female', 'male', 'both'], description: '人形。both は両方' };
const VEC3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };
const TARGET = {
  description: '目標。ワールド座標 [x, y, z]（m、y が上、床は y=0、向きを変えていない人形は +z を向く）か、人形の部位 {who, part}',
  anyOf: [VEC3, { type: 'object', properties: { who: WHO, part: { type: 'string', enum: PARTS } }, required: ['who', 'part'] }],
};
const COORDS = '座標は m、y が上、床は y=0。向きを変えていない人形は +z（画面の手前）を向き、自分の左は +x';

const json = (x) => JSON.stringify(x, null, 1);

export default function init(ctx) {
  const { apply, figs, props } = ctx;
  // 状態を変える道具の共通の手順: 元に戻すの記録 → 操作 → 保存
  const change = (fn) => {
    ctx.pushUndo();
    const out = fn();
    ctx.persist();
    ctx.refreshSel();
    return out;
  };
  const run = (ops) => change(() => apply(ops).join('\n'));
  const click = (id) => document.getElementById(id).click();
  const prop = (i) => {
    const p = props.list[i];
    if (!p) throw new Error(`小物 ${i} は無い（0〜${props.list.length - 1}）`);
    return p;
  };
  // 小物の状態。回転は度で返す（道具の引数と同じ単位）
  const propOut = (p) => {
    const { ry, ...s } = p.getState();
    return { index: props.list.indexOf(p), ...s, rotation: Math.round(ry / D2R) };
  };
  const propSet = (p, { x, z, rotation, width, height, depth }) => {
    const s = p.getState();
    p.set({
      size: [width ?? s.size[0], height ?? s.size[1], depth ?? s.size[2]],
      pos: [x ?? s.pos[0], z ?? s.pos[1]],
      ry: rotation != null ? rotation * D2R : s.ry,
    });
  };

  const TOOLS = [
    {
      name: 'get_scene',
      description: `今の場面を JSON で返す。人形ごとの関節の角度（度）・位置 pos・向き rot（度）・体型・姿勢・手の形、表示中の人形、小物（壁・箱）、編集中の人形。${COORDS}`,
      annotations: { readOnlyHint: true },
      inputSchema: { type: 'object', properties: {} },
      execute: () => json({
        dolls: Object.fromEntries(Object.entries(figs).map(([w, f]) => [w, { visible: f.root.visible, ...f.getState() }])),
        props: props.list.map(propOut),
        editing: ctx.who,
        selected: ctx.getSelected() ? { who: ctx.getSelected().fig.who, joint: ctx.getSelected().joint } : null,
      }),
    },
    {
      name: 'get_reference',
      description: '関節の名前・3 つの角度の意味・可動域、部位の名前、姿勢のプリセット、手の形、体型の種類を返す。関節を動かす前に読む',
      annotations: { readOnlyHint: true },
      inputSchema: { type: 'object', properties: {} },
      execute: () => json({
        coordinates: COORDS,
        joints: Object.fromEntries(Object.entries(JOINTS).map(([j, k]) => [j, AXES[k].map((a, i) => (a === '-' ? '-' : `${a} ${LIMITS[k][i][0]}〜${LIMITS[k][i][1]}`))])),
        parts: PARTS,
        posePresets: Object.keys(POSES),
        handShapes: Object.fromEntries(Object.entries(SHAPES).map(([k, v]) => [k, v.label])),
        bodyTypes: Object.fromEntries(Object.entries(BODIES).map(([w, p]) => [w, Object.keys(p)])),
      }),
    },
    {
      name: 'set_joints',
      description: '関節の角度を度で直接決める。値は [軸 1, 軸 2, 軸 3]（省略や null の軸は今の値のまま）。軸の意味と可動域は get_reference。可動域の外は切り詰めて、その旨を返す',
      inputSchema: {
        type: 'object',
        properties: {
          who: WHO,
          joints: {
            type: 'object',
            description: '関節名 → [度, 度, 度]。例 {"leftElbow": [90], "head": [0, 0, 30]}',
            propertyNames: { enum: Object.keys(JOINTS) },
            additionalProperties: { type: 'array', items: { type: ['number', 'null'] }, maxItems: 3 },
          },
        },
        required: ['who', 'joints'],
      },
      execute: ({ who, joints }) => run([{ op: 'pose', who, joints }]),
    },
    {
      name: 'reach',
      description: `手先か足先を目標へ届かせる（IK）。肘・膝の向きは elbow で指定できる。${COORDS}`,
      inputSchema: {
        type: 'object',
        properties: {
          who: WHO,
          limb: { type: 'string', enum: ['leftHand', 'rightHand', 'leftFoot', 'rightFoot'] },
          to: TARGET,
          offset: { ...VEC3, description: '目標の部位からのずれ [左, 上, 前]（m、相手の体の向き）' },
          elbow: { type: 'string', enum: ['out', 'down', 'back', 'forward', 'up', 'in'], description: '肘・膝を向ける方向' },
        },
        required: ['who', 'limb', 'to'],
      },
      execute: (op) => run([{ op: 'reach', ...op }]),
    },
    {
      name: 'look_at',
      description: '頭を目標へ向ける',
      inputSchema: { type: 'object', properties: { who: WHO, to: TARGET }, required: ['who', 'to'] },
      execute: (op) => run([{ op: 'look', ...op }]),
    },
    {
      name: 'set_pose_preset',
      description: '姿勢のプリセットにする（立つ、座る、しゃがむ、寝るなど）。向き（ヨー）は保つ',
      inputSchema: { type: 'object', properties: { who: WHO_BOTH, name: { type: 'string', enum: Object.keys(POSES) } }, required: ['who', 'name'] },
      execute: (op) => run([{ op: 'preset', ...op }]),
    },
    {
      name: 'place_doll',
      description: `人形を置く。pos は腰の位置 [x, y, z]（y を null にすると高さはそのまま）、rot は [前へ倒す, 左へ向く, ロール]（度）。ground で床に下ろす。${COORDS}`,
      inputSchema: {
        type: 'object',
        properties: {
          who: WHO,
          pos: { type: 'array', items: { type: ['number', 'null'] }, minItems: 3, maxItems: 3 },
          rot: { type: 'array', items: { type: ['number', 'null'] }, minItems: 3, maxItems: 3 },
          ground: { type: 'boolean', description: '置いた後に床へ下ろす（既定 true）' },
        },
        required: ['who'],
      },
      execute: ({ who, pos, rot, ground = true }) => run([{ op: 'place', who, pos, rot }, ...(ground ? [{ op: 'ground', who }] : [])]),
    },
    {
      name: 'face_toward',
      description: '人形の体を目標の方へ向ける（縦軸の回転だけ）',
      inputSchema: { type: 'object', properties: { who: WHO, to: TARGET }, required: ['who', 'to'] },
      execute: (op) => run([{ op: 'face', ...op }]),
    },
    {
      name: 'set_hand',
      description: '手の形を変える。ball と gun はボール・拳銃を持たせる',
      inputSchema: {
        type: 'object',
        properties: {
          who: WHO_BOTH,
          hand: { type: 'string', enum: ['left', 'right', 'both'] },
          shape: { type: 'string', enum: Object.keys(SHAPES), description: Object.entries(SHAPES).map(([k, v]) => `${k}: ${v.label}`).join('、') },
          amount: { type: 'number', minimum: 0, maximum: 1, description: '握り具合（0 で開いた手、1 でその形）' },
        },
        required: ['who', 'shape'],
      },
      execute: (op) => run([{ op: 'hand', ...op }]),
    },
    {
      name: 'set_body',
      description: '体型を変える。preset は種類（get_reference の bodyTypes）、ほかは倍率（1 が標準）。bust・bustSpread は女性だけ',
      inputSchema: {
        type: 'object',
        properties: {
          who: WHO_BOTH,
          preset: { type: 'string' },
          height: { type: 'number', minimum: 0.85, maximum: 1.15 },
          shoulder: { type: 'number', minimum: 0.85, maximum: 1.2 },
          hip: { type: 'number', minimum: 0.85, maximum: 1.2 },
          muscle: { type: 'number', minimum: 0.6, maximum: 1.6 },
          fat: { type: 'number', minimum: 0.3, maximum: 2.2 },
          bust: { type: 'number', minimum: 0, maximum: 1.4 },
          bustSpread: { type: 'number', minimum: 0.5, maximum: 1.8 },
        },
        required: ['who'],
      },
      execute: (op) => run([{ op: 'body', ...op }]),
    },
    {
      name: 'set_posture',
      description: '姿勢の癖を変える。chest は -1（背を丸める）〜 1（胸を開く）、shrug は肩をすくめる 0〜1、neck は首を前に出す 0〜1',
      inputSchema: {
        type: 'object',
        properties: {
          who: WHO_BOTH,
          chest: { type: 'number', minimum: -1, maximum: 1 },
          shrug: { type: 'number', minimum: 0, maximum: 1 },
          neck: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['who'],
      },
      execute: (op) => run([{ op: 'posture', ...op }]),
    },
    {
      name: 'set_camera',
      description: 'カメラを変える。view は決まった視点、focal は焦点距離（mm）、fisheye は魚眼、roll は傾き（度）',
      inputSchema: {
        type: 'object',
        properties: {
          view: { type: 'string', enum: ['front', 'high', 'low', 'side', 'diag'], description: 'front: 正面、high: 上から、low: 下から、side: 横、diag: 斜め' },
          focal: { type: 'number', minimum: 14, maximum: 200 },
          fisheye: { type: 'boolean' },
          fisheyeAngle: { type: 'number' },
          roll: { type: 'number' },
        },
      },
      execute: (op) => change(() => apply([{ op: 'camera', ...op }]).join('\n')),
    },
    {
      name: 'show_dolls',
      description: '人形を表示するか決める。隠した人形は選べず、動かす道具は効くが画面には出ない',
      inputSchema: { type: 'object', properties: { female: { type: 'boolean' }, male: { type: 'boolean' } } },
      execute: (v) => {
        for (const [w, on] of Object.entries(v)) {
          const box = document.querySelector(`#panel input[type=checkbox][data-who="${w}"]`);
          if (!box || on == null || box.checked === on) continue;
          box.checked = on;
          box.dispatchEvent(new Event('change'));
        }
        return json(Object.fromEntries(Object.entries(figs).map(([w, f]) => [w, f.root.visible])));
      },
    },
    {
      name: 'add_prop',
      description: `床に置く小物（壁か箱の直方体）を足す。x, z は中心の位置、rotation は縦軸の回転（度）、width・height・depth は大きさ（m）。省略すると壁は幅 6・高さ 2.7・厚さ 0.12、箱は 0.5・0.45・0.5。足した小物の index を返す。${COORDS}`,
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: Object.keys(KINDS), description: 'wall: 壁、box: 箱' },
          x: { type: 'number' }, z: { type: 'number' }, rotation: { type: 'number' },
          width: { type: 'number', minimum: 0.02 }, height: { type: 'number', minimum: 0.02 }, depth: { type: 'number', minimum: 0.02 },
        },
        required: ['kind'],
      },
      execute: ({ kind, ...rest }) => change(() => {
        const p = props.add(kind);
        propSet(p, rest);
        return json(propOut(p));
      }),
    },
    {
      name: 'update_prop',
      description: '小物を動かす・回す・大きさを変える。index は get_scene の props の index。省略した値はそのまま',
      inputSchema: {
        type: 'object',
        properties: {
          index: { type: 'integer', minimum: 0 },
          x: { type: 'number' }, z: { type: 'number' }, rotation: { type: 'number' },
          width: { type: 'number', minimum: 0.02 }, height: { type: 'number', minimum: 0.02 }, depth: { type: 'number', minimum: 0.02 },
        },
        required: ['index'],
      },
      execute: ({ index, ...rest }) => change(() => {
        const p = prop(index);
        propSet(p, rest);
        return json(propOut(p));
      }),
    },
    {
      name: 'remove_prop',
      description: '小物を消す（元に戻すで戻せる）',
      annotations: { consequentialHint: true },
      inputSchema: { type: 'object', properties: { index: { type: 'integer', minimum: 0 } }, required: ['index'] },
      execute: ({ index }) => change(() => {
        const p = prop(index);
        if (ctx.getSelectedProp() === p) ctx.selectProp(null);
        props.remove(p);
        return `小物 ${index} を消した`;
      }),
    },
    {
      name: 'undo',
      description: '直前の変更を元に戻す',
      inputSchema: { type: 'object', properties: {} },
      execute: () => { click('undo'); return 'ok'; },
    },
    {
      name: 'reset_scene',
      description: '人形を初期配置（並んで立つ）に戻す。小物はそのまま。元に戻すで戻せる',
      annotations: { consequentialHint: true },
      inputSchema: { type: 'object', properties: {} },
      execute: () => { click('reset'); return 'ok'; },
    },
    {
      name: 'run_ops',
      description: '操作の列をまとめて実行する（上級）。各要素は {op, ...}。op は pose・reach・look・preset・place・turn・face・align・ground・reset・hand・body・posture・camera。引数はそれぞれの道具と同じ。turn は {who, yaw, pitch, roll}（度、足し込み）、align は {who, part, to, offset, keepHeight}（部位を目標へ重ねるよう体ごと動かす）。一度の元に戻すでまとめて戻る',
      inputSchema: { type: 'object', properties: { ops: { type: 'array', items: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'] } } }, required: ['ops'] },
      execute: ({ ops }) => run(ops),
    },
  ];

  // 失敗は例外にせず文で返す（エージェントが読んで直せるように）
  const call = async (name, input = {}) => {
    const t = TOOLS.find((x) => x.name === name);
    if (!t) return `unknown tool: ${name}（${TOOLS.map((x) => x.name).join(', ')}）`;
    try {
      return await t.execute(input);
    } catch (e) {
      return `error: ${e.message}`;
    }
  };
  window.posingKun = {
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    call,
  };

  const mc = document.modelContext ?? navigator.modelContext;
  if (!mc?.registerTool) return;
  for (const t of TOOLS) {
    Promise.resolve(mc.registerTool({ ...t, execute: (input) => call(t.name, input) })).catch((e) => console.warn(`WebMCP: ${t.name}`, e));
  }
}

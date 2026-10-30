// 人形の体（球体関節のマネキンの造形）: 部品ごとに閉じた滑らかな形を骨に固く付け、関節には球を置く。皮膚は関節をまたがない。
// 構成: 背骨と胸郭で一つ（骨盤・腹・胸郭を腰・背・胸の骨で曲げる）、鎖骨と肩甲骨で左右一組ずつ（肩の受け口を持つ）、その先に肩の球と腕。
// 肩をすくめる・胸を開く・腕を上げると、鎖骨と肩甲骨の組が胸郭の上を動く。
// 形は部品の骨の座標（静止形、関節の回転なし）で決め、sdf.js の extract で面にする。
import * as THREE from 'three';
import { extract } from './skin/sdf.js';
import { AC, SC } from './girdle.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const D2R = Math.PI / 180;
const rows = (m) => { const e = m.elements; return [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]]; };

function basis(origin, Y, Zh) {
  const y = Y.clone().normalize();
  let z = Zh.clone().addScaledVector(y, -Zh.dot(y));
  if (z.lengthSq() < 1e-8) z = (Math.abs(y.x) < 0.9 ? V(1, 0, 0) : V(0, 1, 0)).cross(y);
  z.normalize();
  return new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z).setPosition(origin);
}

// 部品の形を作る道具。どれも部品の骨の座標
function shapes() {
  const parts = [];
  // o: { k: 他の形と結合する幅（省略は部品の k、二つの形では小さい方）, cleave: 左右の cleave どうしは結合しない, side }
  const add = (kind, F, p, o = {}) => {
    const ext = kind === 'loft' ? [[-Math.max(...p.w) - 0.05, Math.min(...p.ys) - 0.05, Math.min(...p.b) - 0.05], [Math.max(...p.w) + 0.05, Math.max(...p.ys) + 0.05, Math.max(...p.f) + 0.05]]
      : kind === 'ell' ? [[-p[0], -p[1], -p[2]], [p[0], p[1], p[2]]] : (() => { const r = Math.max(p[1], p[2]) * Math.max(1, p[3] ?? 1); return [[-r, -p[0] - r, -r], [r, r, r]]; })();
    const box = new THREE.Box3();
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) box.expandByPoint(V(ext[x][0], ext[y][1], ext[z][2]).applyMatrix4(F));
    parts.push({ kind, m: rows(F.clone().invert()), p, box: [...box.min.toArray(), ...box.max.toArray()], mesh: { body: null }, layer: 'muscle', grp: 'doll', side: o.side ?? 0, jk: o.k, cleave: o.cleave });
  };
  return {
    parts,
    // 中心 C の楕円体。e は Euler（度、XYZ）
    ell: (C, R, e = null, taper = 0, o = {}) => {
      const F = e ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(e[0] * D2R, e[1] * D2R, e[2] * D2R)) : new THREE.Matrix4();
      add('ell', F.setPosition(C), [...R, taper], o);
    },
    // 断面を積み重ねた形（sdf.js の sdLoft）。rows: [[y, 半幅, 前の端 z, 後ろの端 z], ...] 上から下へ。位置は部品の骨の座標のまま
    // extra: { cleft: 段ごとのお尻の割れ目の深さ, groin: 段ごとの鼠蹊部の溝の中心の x（0 は無し）}
    loft: (rows, n = 2.3, o = {}, extra = {}) => add('loft', new THREE.Matrix4(), { ys: rows.map((q) => q[0]), w: rows.map((q) => q[1]), f: rows.map((q) => q[2]), b: rows.map((q) => q[3]), n, ...extra }, o),
    // A から B への円錐（半径 r1 → r2）。fz は hint 方向の半径の倍率
    cone: (A, B, r1, r2, fz = 1, hint = V(0, 0, 1)) => add('cone', basis(A, A.clone().sub(B), hint), [A.distanceTo(B), r1, r2, fz]),
  };
}

// 取り除く範囲（sdf.js の clip）
const above = (y) => [0, 0, 1, 0, y]; // y より上
const below = (y) => [0, 0, -1, 0, -y]; // y より下
const front = (z) => [0, 0, 0, 1, z]; // z より前
const behind = (z) => [0, 0, 0, -1, -z]; // z より後ろ
const ball = (c, r) => [1, c.x, c.y, c.z, r];

// 胴の断面の表（腰の座標、m）: [y, 正面の半幅, 前の端 z, 後ろの端 z]。身長 1.855（頭頂 0.788）の体の寸法
const TORSO = { female: [[0.4819, 0.0408, 0.0237, -0.0283], [0.4727, 0.0501, 0.0251, -0.0315], [0.4634, 0.0594, 0.0265, -0.0347], [0.4541, 0.0761, 0.0298, -0.0333], [0.4448, 0.0927, 0.0331, -0.0365], [0.4356, 0.115, 0.0364, -0.0397], [0.4263, 0.1261, 0.0545, -0.0336], [0.417, 0.1373, 0.0726, -0.0276], [0.4077, 0.1401, 0.0879, -0.0252], [0.3985, 0.1428, 0.1033, -0.0229], [0.3892, 0.1363, 0.113, -0.0205], [0.3799, 0.1299, 0.1228, -0.0182], [0.3706, 0.1317, 0.1275, -0.0168], [0.3614, 0.1336, 0.1321, -0.0153], [0.3521, 0.1354, 0.1368, -0.0139], [0.3428, 0.1373, 0.1415, -0.0125], [0.3335, 0.1363, 0.1468, -0.0113], [0.3243, 0.1354, 0.1522, -0.0101], [0.315, 0.1345, 0.1575, -0.0089], [0.3057, 0.1336, 0.1629, -0.0077], [0.2964, 0.1308, 0.1683, -0.0066], [0.2872, 0.128, 0.1736, -0.0054], [0.2779, 0.1252, 0.179, -0.0042], [0.2686, 0.1224, 0.1844, -0.003], [0.2593, 0.1187, 0.1858, -0.0006], [0.2501, 0.115, 0.1872, 0.0017], [0.2408, 0.1113, 0.1886, 0.0041], [0.2315, 0.1076, 0.19, 0.0064], [0.2222, 0.1057, 0.1868, 0.0083], [0.213, 0.1039, 0.1836, 0.0102], [0.2037, 0.102, 0.1804, 0.0121], [0.1944, 0.1002, 0.1772, 0.0139], [0.1851, 0.1039, 0.173, 0.0098], [0.1759, 0.1076, 0.1689, 0.0057], [0.1666, 0.1113, 0.1648, 0.0015], [0.1573, 0.115, 0.1606, -0.0026], [0.148, 0.1206, 0.1583, -0.0096], [0.1388, 0.1261, 0.156, -0.0165], [0.1295, 0.1317, 0.1537, -0.0234], [0.1202, 0.1373, 0.1515, -0.0303], [0.1109, 0.1438, 0.1501, -0.0359], [0.1017, 0.1503, 0.1487, -0.0414], [0.0924, 0.1567, 0.1474, -0.0469], [0.0831, 0.1632, 0.146, -0.0525], [0.0738, 0.1679, 0.1433, -0.0562], [0.0645, 0.1725, 0.1405, -0.0598], [0.0553, 0.1772, 0.1377, -0.0635], [0.046, 0.1818, 0.135, -0.0672], [0.0367, 0.1827, 0.1318, -0.0686], [0.0275, 0.1836, 0.1286, -0.0699], [0.0182, 0.1846, 0.1253, -0.0713], [0.0089, 0.1855, 0.1221, -0.0726], [-0.0004, 0.1772, 0.1185, -0.0722], [-0.0096, 0.1688, 0.1148, -0.0717], [-0.0189, 0.1605, 0.1111, -0.0712], [-0.0282, 0.1521, 0.1074, -0.0707], [-0.0375, 0.1456, 0.1042, -0.0665], [-0.0467, 0.1391, 0.101, -0.0623], [-0.056, 0.1326, 0.0978, -0.0581], [-0.0653, 0.1261, 0.0945, -0.0539], [-0.0746, 0.115, 0.0879, -0.045], [-0.0838, 0.1039, 0.0813, -0.0362], [-0.0931, 0.0927, 0.0747, -0.0273]] };
const loftFront = (rows, y) => {
  for (let i = 0; i + 1 < rows.length; i++) if (rows[i + 1][0] <= y) { const t = (rows[i][0] - y) / (rows[i][0] - rows[i + 1][0]); return rows[i][2] + (rows[i + 1][2] - rows[i][2]) * t; }
  return rows.at(-1)[2];
};

// 骨盤の部品の上端（腸骨稜、腰の座標の y）。ここから股までを骨盤の部品にする
const PELVIS_TOP = 0.046;

// 部品の一覧: { joint, parts, k, clip, cell }
export function dollSegments(fig) {
  const b = fig.b;
  const female = fig.who === 'female';
  const wS = b.sw / 0.19;
  const ru = b.r.ua, rf = b.r.fa, rt = b.r.th, rs = b.r.sh;
  // 関節の球の半径
  const R = { shoulder: ru[0] * 0.95, elbow: rf[0] * 0.92, hip: rt[0] * 0.7, knee: rs[0] * (female ? 1.05 : 1.08), ankle: rs[1] * 0.95 };
  const segs = [];
  // blend: 一つの部品を複数の骨で曲げる。{ parent: 形の座標の骨（省略は joint）, bones: [[骨, 静止形でのその骨の位置]], weight: 点 → 重み }
  // hip: 股関節まわりを姿勢ごとに組み直す部品（'pelvis' | 'glute' | 'thigh'。buildDoll の hipRegion が使う）
  const seg = (joint, build, { k = 0.03, clip = [], cell = 0.004, blend = null, hip = null } = {}) => {
    const s = shapes();
    build(s);
    segs.push({ joint, parts: s.parts, k, clip, cell, blend, hip });
  };

  // ---- 胴: 骨盤・腹・胸郭を一つの部品にし、腰・背・胸の骨で高さに応じて曲げる（腰の座標で作る）
  const [c0, c1, c2] = b.chest, [w0, w1, w2] = b.waist, [p0, p1, p2] = b.pelvis;
  const SP = 0.08, CH = 0.23; // 背と胸の関節の高さ
  const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  seg('hips', ({ ell, parts, loft }) => {
    if (female) {
      // 女性の胴は断面を積み重ねて作る（骨盤・腹・胸郭・背中・お尻を一つの形で）。断面は TORSO の表
      // 胴は首の関節から腸骨稜の少し下まで（下端は骨盤の部品の中に隠れる）。骨盤から下は別の部品
      loft(TORSO.female.filter(([y]) => y >= PELVIS_TOP - 0.05));
      // 胸板は胴の断面が持つ（首の付け根のすぐ下から前へ張り、乳房の付け根へ続く。別の形を載せると縁が棚になる）
    } else {
    // 骨盤の塊（骨盤・お尻・腸骨の張り出し・下腹）は股関節の高さを軸に前へ傾ける。お尻は塊の後ろ上になり、腰のくぼみから太ももの裏へ一続きになる
      const tilt = female ? 0 : 6, pivot = V(0, -0.06, 0); // 女性の前傾は骨格（Figure の curve.pelvis）で付ける
      const at = (C) => C.clone().sub(pivot).applyAxisAngle(V(1, 0, 0), tilt * D2R).add(pivot);
      const pel = (C, R, e = [0, 0, 0]) => ell(at(C), R, [e[0] + tilt, e[1], e[2]]);
      if (female) {
        // 女性の骨盤: くびれから腰幅まで広がり、太ももの上端はこの輪郭の内に収まる。下は股へ細る
        pel(V(0, 0.01, -0.018), [0.175, 0.18, 0.096], [0, 0, 0]);
        parts.at(-1).p[3] = -0.75;
        // お尻は丸く、腰のくぼみのすぐ下に。位置だけ骨盤と一緒に傾け、向きはまっすぐ（傾けると長い軸の先が後ろへ尖る）
        for (const s of [1, -1]) ell(at(V(s * 0.056, -0.035, -0.074)), [0.088, 0.098, 0.09]);
      } else {
        pel(V(0, -0.025, -0.005), [p0 * 0.95, p1 * 1.05, p2 * 0.95]);
        for (const s of [1, -1]) pel(V(s * 0.062, -0.07, -0.05), [0.07, 0.075, 0.065]);
      }
      if (!female) pel(V(0, -0.085, 0.03), [p0 * 0.55, 0.05, 0.06]);
      // 女性の腹は前へ寄せ、背中側だけがくぼむ（前の線は胸から下腹へほぼまっすぐ）
      // 女性の腹は細い柱。楕円体は真ん中が一番太いので、太くするとへその高さが張ってくびれが胸の下へ上がる
      // 女性はくびれの一番細い所を少し下に（腹の柱を下げて下側を太く、上は胸郭の下で細く）
      ell(V(0, SP + (female ? 0.035 : 0.06), female ? -0.012 : -0.004), [w0 * (female ? 0.86 : 1), w1 * 1.25, w2 * (female ? 0.66 : 1)], null, female ? 0.3 : 0);
      // 胸郭は前寄りに浅く、背中は幅の広い薄い板で平たくする（一つの楕円体だと背中も前と同じだけ丸く張り出す）
      // 女性は胸郭の下を少し広げ、胸の下からくびれへだんだん細くなる
      // 女性の胸郭は大きく深く、下はくびれの近くまで（腹は胸郭の下に短く収まる）
      // 胸郭がすぼまるのはくびれのすぐ上（腹は短い）
      if (female) ell(V(0, CH + 0.065, 0.012), [c0 * 0.98, c1 * 1.45, c2 * 0.98], null, 0.35);
      else ell(V(0, CH + 0.105, 0.01), [c0 * 0.94, c1 * 1.12, c2 * 0.85], null, 0.25);
      // 背中の板は左右に分け、間に背骨の溝を残す。左右の板は肩甲骨と一緒に動き、胸を張ると背骨へ寄る
      for (const s of [1, -1]) ell(V(s * 0.058, CH + 0.11, -c2 * 0.45), [c0 * 0.55, c1 * 1.02, 0.05], [-6, 0, 0]);
      // 腰の背骨の両側の筋（脊柱起立筋）: 腰から背中の中ほどまで縦に盛り上がり、間が溝になる
      for (const s of [1, -1]) ell(V(s * 0.03, SP + 0.08, -w2 * 0.72), [0.026, 0.13, 0.03]);
      // 背中の上は首の付け根と肩の帯の高さまで伸ばし、肩甲骨の辺りが肩と首の下へなだらかに続く（下へ広く取って段を作らない）
      ell(V(0, CH + 0.19, -0.045), [b.sw * 0.72, 0.085, 0.05]);
      // 肩甲骨は形を足さない（足すと平たい背中から浮いて縁が出っ張りに見える）。背中の皮膚が肩甲骨と一緒に胸郭の上を滑るだけ
    }
    for (const s of [1, -1]) {
      if (b.bust) {
        // 胸: 丸い胸郭の表面の上寄りから生え、少し外・下を向く。重さの分だけ中心が下がる（大きいほど下へ）。
        // 付け根の上は胴の表面に沿うなだらかな面で、正面から上部が見える。胴とは小さい幅で結合し、左右どうしは結合しない（谷間が残る）
        const k = b.bust === true ? 1 : b.bust, r = 0.072 * k, d = k - 1;
        // 付け根は胸の幅の半分ほど外（左右の頂点の間が 18cm 前後）
        // 胸郭の上に乗り、重さで下側がふくらむ。前への突き出しは控えめで、頂点は付け根より下
        // 広がり sp: 付け根の間隔と外向きを増やす（1 が標準。左右の胸が重ならない間隔）
        const sp = b.bustSpread ?? 1;
        const root = V(s * (c0 * (0.44 + 0.12 * (sp - 1)) + 0.012 * d), CH + 0.135, loftFront(TORSO.female, CH + 0.135) - 0.035), dir = V(s * 0.38 * sp, -0.55 - 0.08 * d, 1).normalize();
        const o = { k: 0.02, cleave: true, side: s };
        ell(root.clone().addScaledVector(dir, r * 0.7).add(V(0, -0.018 - 0.008 * d, 0.014)), [r * 1.02, r * 1.1, r * 1.0], [-12, s * -8, 0], 0, o);
        // 上のスロープ: 鎖骨の下から胸の上へ、胴に沿ってなだらかに
      } else ell(V(s * c0 * 0.38, CH + 0.135, c2 * 0.62), [0.068, 0.052, 0.032], [0, s * 18, 0]);
    }
  }, {
    // 骨盤は閉じた塊のまま（股関節の受け口は削らない。削ると太ももを動かしたときにお尻に稜線と削り跡が出る）
    k: 0.045, cell: 0.004,
    blend: {
      bones: [['hips', V(0, 0, 0)], ['spine', V(0, SP, 0)], ['chest', V(0, CH, 0)],
        // 肩甲骨は皮膚の下で回る: 位置の動きは全部、回転は 3 割だけ皮膚へ渡す（全部渡すと腕を上げたとき範囲の縁で皮膚が折れ返る）
        ['leftScapula', V(...AC(1, b.sw)).add(V(0, CH, 0)), { rot: 0.3 }], ['rightScapula', V(...AC(-1, b.sw)).add(V(0, CH, 0)), { rot: 0.3 }],
        // 胸板の左右は鎖骨と動く（胸を張る・すくめる・腕を上げる）。中央（胸骨）は胸の骨のまま
        ['leftClavicle', V(...SC(1)).add(V(0, CH, 0)), { rot: 0 }], ['rightClavicle', V(...SC(-1)).add(V(0, CH, 0)), { rot: 0 }],
        // 肩の受け口の周りは肩の土台（鎖骨の先）と完全に一緒に動く。肩の球と腕は鎖骨の先に付くので、ここが残ると腕を上げたとき球が胴から浮く
        ['leftClavicle', V(...SC(1)).add(V(0, CH, 0))], ['rightClavicle', V(...SC(-1)).add(V(0, CH, 0))]],
      weight: (p) => {
        // お尻と骨盤（上端 y≒0.05）は骨盤の骨だけに付け、背の骨へはくびれ（0.05〜0.21）で、胸の骨へは 0.15〜0.35 で広く重ねて移す。
        // 移る範囲が狭いと背骨が腰で折れて見える。低くするとお尻の上が背と一緒に動いて抉れる
        const h = sm((0.21 - p.y) / 0.16);
        // 胸（乳房）は胸の骨だけに付ける: 胴の前面より前に出た所で、胸郭の高さのもの。背を反らしても胸の上に残る
        const bust = female ? sm((p.z - loftFront(TORSO.female, p.y) + 0.015) / 0.02) * sm((p.y - CH) / 0.03) : 0;
        const c = Math.max(sm((p.y - 0.15) / 0.2), bust);
        // 中心ではほぼ全部（0.9）、縁へ向かって弱く。胸を張ると左右の範囲が背骨へ寄り、その間に溝ができる
        const sc = (s) => 0.6 * sm(1 - Math.hypot((p.x - s * 0.085 * wS) / 0.08, (p.y - CH - 0.125) / 0.12)) ** 1.5 * sm((-p.z - 0.04) / 0.03);
        // 胴の上の左右（胸板と背中の上・肩の上）: 中央から外ほど、上ほど肩甲帯と動く。前は鎖骨、後ろは肩甲骨
        const up = (s) => (female ? 0.55 : 0) * sm((s * p.x - 0.04) / 0.08) * sm((p.y - CH - 0.1) / 0.1);
        const front = sm((p.z + 0.02) / 0.04);
        const g = [1, -1].map((s) => up(s));
        const l = Math.max(sc(1), g[0] * (1 - front)), rr = Math.max(sc(-1), g[1] * (1 - front));
        const cl = g[0] * front * (1 - bust), cr = g[1] * front * (1 - bust);
        // 肩の球の中心（胸の座標で (±sw, 0.21, 0)、腰の座標では +CH）から 5cm は全部、10cm で 0
        const sock = (s) => (female ? 1 : 0) * sm((0.1 - Math.hypot(p.x - s * b.sw, p.y - CH - 0.21, p.z)) / 0.05);
        const kl = sock(1), kr = sock(-1), q = 1 - kl - kr;
        const k = Math.max(0, 1 - l - rr - cl - cr) * q;
        return [h * k, Math.max(0, 1 - h - c) * k, c * k, l * q, rr * q, cl * q, cr * q, kl, kr];
      },
      // 背骨は曲線で曲げる。向きは 骨盤（0）→ 背（背と胸の中ほど）→ 胸（胸の関節の少し上）の間をなめらかに
      spine: { bones: [0, 1, 2], rel: [3, 4, 5, 6, 7, 8], knots: [[0.02, 0], [(SP + CH) / 2, 1], [CH + 0.07, 2]], end: [CH, 2] },
      onto: { bones: [3, 4], frame: 2, c: V(0, CH + 0.105, -0.005), r: V(c0 * 0.94, c1 * 1.12, c2) },
    },
  });

  // ---- 骨盤（女性）: 腸骨稜から股までの一つの部品。腰の骨に固く付く。前から見て股へすぼむ丸い V、後ろに左右のお尻
  if (female) {
    seg('hips', ({ ell }) => {
      // 下へすぼむ楕円体一つ: 上は腸骨稜の幅、下は股へ細って丸く閉じる（taper が -Y 側を細める）
      ell(V(0, -0.02, -0.01), [0.17, 0.105, 0.098], [-8, 0, 0], -0.62);
    }, { k: 0.03, cell: 0.004, hip: 'pelvis' });
  }

  // ---- 肩甲帯: 鎖骨と肩甲骨を左右一組の部品にする（胸の座標で作る）。肩の受け口と前・上は鎖骨、後ろは肩甲骨と動く。肩甲骨のふくらみは胴の側
  for (const [s, n] of [[1, 'left'], [-1, 'right']]) {
    const sh = V(s * b.sw, 0.21, 0); // 肩の球の中心
    seg(`${n}Clavicle`, ({ cone, ell }) => {
      // 首の付け根から肩先へ下りる僧帽筋の斜面と、肩の角
      // 女性は首から肩へなで下ろす（首の付け根が高く、肩先へ下がって肩の球に丸く入る）。角の塊は置かない
      if (female) {
        // 首から肩先への斜面は胴の上端が持つ（胴の上の左右は肩甲帯と動く）。ここは肩の受け口の周りだけ
      } else {
        cone(V(s * 0.03, 0.255, -0.025), V(s * (b.sw - 0.035), 0.225, -0.012), 0.036, 0.034, 1.25, V(0, 0, 1));
        ell(V(s * (b.sw - 0.045), 0.2, -0.004), [0.045, 0.04, 0.055]);
      }
      // 肩の受け口の後ろ（肩甲骨の外の角）
      ell(V(s * (b.sw - 0.055), 0.175, -0.04), [0.04, 0.045, 0.035]);
    }, {
      clip: [ball(sh, R.shoulder * 0.97)],
      blend: {
        parent: 'chest',
        bones: [[`${n}Clavicle`, V(...SC(s))], [`${n}Scapula`, V(...AC(s, b.sw)), { rot: 0.3 }], ['chest', V(0, 0, 0)]],
        // 受け口の周り（肩の球から 6cm）は鎖骨だけ。肩甲骨と動かすと腕を上げたとき縁が球から離れて隙間が開く。
        // 首の付け根の側（中央から 7cm まで）は胸の骨に残す（鎖骨と上がると首の後ろに角が立つ）
        weight: (p) => {
          const c = sm((0.08 - Math.abs(p.x)) / 0.05), w = sm((-p.z - 0.045) / 0.03) * sm((p.distanceTo(sh) - 0.06) / 0.03);
          return [(1 - w) * (1 - c), w * (1 - c), c];
        },
      },
    });
  }

  // ---- 首と頭
  seg('neck', ({ cone }) => cone(V(0, -0.035, -0.006), V(0, 0.105, 0.004), b.r.neck, b.r.neck * 0.93), { cell: 0.004 });
  // 頭: 頭蓋（後頭部が後ろへふくらむ）、顔、あご
  seg('head', ({ ell }) => {
    ell(V(0, 0.112, -0.004), [0.08, 0.1, 0.094]);
    ell(V(0, 0.122, -0.036), [0.07, 0.078, 0.072]);
    ell(V(0, 0.085, 0.03), [0.068, 0.09, 0.068]);
    // 顎: 下あごの線を首から離し、先端を小さく前へ出す（顔の向きがわかる）
    ell(V(0, 0.04, 0.05), [0.045, 0.03, 0.042]);
    ell(V(0, 0.022, 0.078), [0.022, 0.018, 0.02]);
  }, { k: 0.028 });
  // 鼻と耳: 向きがわかる程度の簡単な形。頭とは小さい幅で結合する
  seg('head', ({ ell }) => {
    ell(V(0, 0.072, 0.103), [0.013, 0.025, 0.017], [-18, 0, 0]);
    ell(V(0, 0.055, 0.1), [0.019, 0.01, 0.013]);
    for (const s of [1, -1]) ell(V(s * 0.078, 0.088, -0.006), [0.009, 0.026, 0.016], [-12, s * 15, 0]);
  }, { k: 0.004, cell: 0.0025 });

  // ---- 腕と脚: 関節の手前で切り、球の分だけ空ける
  for (const n of ['left', 'right']) {
    seg(`${n}Shoulder`, ({ cone, ell }) => {
      cone(V(0, 0, 0), V(0, -b.ua, 0), ru[0] * 1.02, ru[1]);
      ell(V(0, -0.065, 0), [ru[0] * 1.12, 0.075, ru[0] * 1.06]);
    }, { clip: [above(-R.shoulder * 0.72), below(-b.ua + R.elbow * 0.75)] });
    seg(`${n}Elbow`, ({ cone, ell }) => {
      cone(V(0, 0, 0), V(0, -b.fa, 0), rf[0] * 1.04, rf[1], 0.88);
      ell(V(0, -0.075, 0), [rf[0] * 1.14, 0.085, rf[0] * 0.98]);
    }, { clip: [above(-R.elbow * 0.72), below(-b.fa + rf[1] * 0.55)] });
    const s = n === 'left' ? 1 : -1;
    // 女性の太ももの上端は外が高く内が低い斜めの面で切る。骨盤との境目が腰骨から股へ下りる斜めの線になる。切り口の縁は大きく丸め、骨盤の外では付け根が丸い肩になる
    // 女性の太ももの上端は股（内）から腰骨（外）へ 50° で上がる面で切る。骨盤との境目が V 字になり、
    // 腰の外の張りは太ももの側にあって、くびれから膝まで外の輪郭が一続きになる
    const slant = 50 * D2R, hipCut = female ? [0, -s * Math.sin(slant), Math.cos(slant), 0, 0.001, 0.045] : above(0);
    seg(`${n}Hip`, ({ cone, ell }) => {
      if (female) {
        // 付け根から膝へ細る。膝の上は膝の球より細い
        // 上端は骨盤の輪郭の内に収め（はみ出すと段になる）、一番張るのは股の高さ。そこから膝へ細る
        // 付け根は股関節を包む丸い肩（骨盤の V 字の外に出て、腰の外の輪郭と鼠蹊部の線を作る）
        ell(V(s * 0.016, -0.03, -0.004), [rt[0] * 1.15, 0.1, rt[0] * 1.08]);
        // 太ももの内側は付け根から膝へ細く、外へ寄せる（直立で股の間が少し開く）
        cone(V(s * 0.012, -0.07, 0), V(0, -b.th, 0), rt[0] * 1.08, rs[0] * 0.92);
        ell(V(s * 0.016, -0.17, 0.008), [rt[0] * 1.1, 0.21, rt[0] * 1.08]);
        ell(V(s * 0.03, -0.075, -0.01), [0.09, 0.13, 0.08]);
        // 付け根の裏を太くし、お尻の下から膝へなだらかに細くする
        ell(V(s * 0.006, -0.1, -0.035), [rt[0] * 0.98, 0.15, rt[0] * 1.06]);
      } else {
        // 上端は丸いまま股関節の高さまで伸ばして骨盤の中に収める（平らに切るとお尻の下が切り口で隠れて箱に見える）
        cone(V(0, -0.05, 0), V(0, -b.th, 0), rt[0] * 1.05, rt[1]);
        ell(V(0, -0.18, 0.012), [rt[0] * 1.06, 0.16, rt[0] * 1.04]);
      }
    }, { clip: female ? [below(-b.th + R.knee * 0.75)] : [hipCut, below(-b.th + R.knee * 0.75)], cell: 0.005, hip: female ? 'thigh' : null });
    // お尻: 太ももの付け根の後ろへ伸びて丸く張り、太ももと広く溶け合う（太ももの裏の線がそのままお尻の線になる）。
    // 股関節の回転の半分だけ太ももについていく（全部ついていくと脚を上げたとき腰の上へ突き出る）
    if (female) seg(`${n}Hip`, ({ ell }) => ell(V(-s * 0.03, -0.035, -0.058), [0.088, 0.095, 0.08], [-12, 0, 0]), { hip: 'glute' });
    seg(`${n}Knee`, ({ cone, ell }) => {
      // 脛: 膝の下で細く、ふくらはぎは上 1/3 で後ろ・内へふくらみ、足首へ細る
      cone(V(0, 0, 0), V(0, -b.sh + 0.01, 0), rs[0] * 0.88, rs[1] * 0.78);
      ell(V(-s * 0.004, -0.115, -0.026), [rs[0] * 1.18, 0.13, rs[0] * 1.24]);
      // くるぶし: 内は高く前、外は低く後ろ
      ell(V(-s * 0.022, -b.sh + 0.008, 0.004), [0.011, 0.016, 0.014]);
      ell(V(s * 0.026, -b.sh - 0.004, -0.008), [0.011, 0.016, 0.013]);
    }, { k: 0.015, clip: [[...above(-R.knee * 0.75), 0.025], ball(V(0, -b.sh, 0), R.ankle * 0.97), below(-b.sh - 0.02)] });
    seg(`${n}Ankle`, ({ ell }) => {
      ell(V(0, -0.048, -0.022), [0.032, 0.032, 0.04]);
      ell(V(0, -0.05, 0.06), [0.048, 0.028, 0.1]);
      ell(V(0, -0.056, 0.125), [0.056, 0.021, 0.045]);
    }, { clip: [above(-R.ankle * 0.55), front(0.152)] });
    // 足の指: 付け根の帯から 5 本。親指は内側で太く長い
    seg(`${n}Toe`, ({ ell }) => {
      ell(V(s * 0.002, -0.004, 0.006), [0.05, 0.015, 0.013]);
      ell(V(-s * 0.026, -0.001, 0.034), [0.015, 0.014, 0.028]);
      [[-0.006, 0.03, 0.011], [0.011, 0.027, 0.0105], [0.026, 0.022, 0.0098], [0.039, 0.016, 0.009]].forEach(([x, z, r]) => ell(V(s * x, -0.004, z), [r, r * 0.95, r * 1.9]));
    }, { k: 0.006, clip: [behind(0.0)], cell: 0.0025 });
  }
  return { segs, R };
}

const cache = new Map();
function geometryOf(sg) {
  const key = JSON.stringify([sg.parts.map((p) => [p.m, p.p]), sg.clip, sg.k]);
  if (cache.has(key)) return cache.get(key);
  const box = new THREE.Box3();
  for (const p of sg.parts) box.union(new THREE.Box3(V(...p.box.slice(0, 3)), V(...p.box.slice(3))));
  box.expandByScalar(sg.k + sg.cell * 3);
  const min = box.min.toArray();
  const n = box.max.toArray().map((x, i) => Math.ceil((x - min[i]) / sg.cell) + 1);
  const edges = [];
  for (let i = 0; i < sg.parts.length; i++) for (let j = i + 1; j < sg.parts.length; j++) {
    const p = sg.parts[i], q = sg.parts[j];
    if (p.cleave && q.cleave && p.side * q.side < 0) continue;
    const k = Math.min(p.jk ?? sg.k, q.jk ?? sg.k);
    edges.push([i, j, k, k, 0, 0, 0, 0]);
  }
  const m = extract(sg.parts, edges, { min, n, cell: sg.cell, g: null }, 'body', null, null, sg.clip);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.userData.doll = true;
  cache.set(key, g);
  return g;
}

// 背骨の曲線の表: 高さ y（静止形）ごとの [点 x, y, z, 向き qx, qy, qz, qw]。
// 向きは spine.knots（[高さ, 骨の番号]）の間を smoothstep で slerp し、点は向きを下から積み上げる（骨の継ぎ目で折れない）。
// 積み上げた曲線は spine.end の高さで骨格の関節の位置へ合うよう、0..end で直線的に寄せる
function spineTable(spine, M) {
  const { knots, end, y0 = -0.3, y1 = 0.7, dy = 0.004 } = spine;
  const n = Math.round((y1 - y0) / dy) + 1, t = new Float64Array(7 * n);
  const qs = knots.map(([, i]) => new THREE.Quaternion().setFromRotationMatrix(M[i]));
  const q = new THREE.Quaternion(), up = V(0, 1, 0), p = V(0, 0, 0);
  const rotAt = (y) => {
    if (y <= knots[0][0]) return q.copy(qs[0]);
    for (let i = 1; i < knots.length; i++) {
      if (y <= knots[i][0]) {
        const u = (y - knots[i - 1][0]) / (knots[i][0] - knots[i - 1][0]);
        return q.copy(qs[i - 1]).slerp(qs[i], u * u * (3 - 2 * u));
      }
    }
    return q.copy(qs.at(-1));
  };
  const base = V(0, 0, 0).applyMatrix4(M[knots[0][1]]);
  const i0 = Math.round(-y0 / dy);
  const put = (k, pos) => { const r = rotAt(y0 + k * dy); t.set([pos.x, pos.y, pos.z, r.x, r.y, r.z, r.w], 7 * k); };
  p.copy(base); put(i0, p);
  for (let k = i0 + 1; k < n; k++) { p.addScaledVector(up.set(0, 1, 0).applyQuaternion(rotAt(y0 + (k - 0.5) * dy)), dy); put(k, p); }
  p.copy(base);
  for (let k = i0 - 1; k >= 0; k--) { p.addScaledVector(up.set(0, 1, 0).applyQuaternion(rotAt(y0 + (k + 0.5) * dy)), -dy); put(k, p); }
  const ke = Math.round((end[0] - y0) / dy), target = V(0, end[0], 0).applyMatrix4(M[end[1]]);
  const dx = target.x - t[7 * ke], dyy = target.y - t[7 * ke + 1], dz = target.z - t[7 * ke + 2];
  for (let k = i0; k < n; k++) {
    const f = Math.min(1, (k - i0) / (ke - i0));
    t[7 * k] += dx * f; t[7 * k + 1] += dyy * f; t[7 * k + 2] += dz * f;
  }
  return { t, n, y0, dy };
}

// 股関節まわり（骨盤・お尻・左右の太もも）を、姿勢を取った位置で一つの距離場に溶け合わせ、股関節の角度が変わったら面を取り直す。
// お尻は股関節の回転の GLUTE_FOLLOW だけ太ももについていく。形は腰の座標で組み、腰の骨に付ける
const GLUTE_FOLLOW = 0.5;
const HIP_JOINTS = ['hips', 'leftHip', 'rightHip'];
const K_HIP = { 'pelvis|thigh': 0.035, 'glute|thigh': 0.07, 'glute|pelvis': 0.05, 'glute|glute': 0, 'thigh|thigh': 0, 'pelvis|pelvis': 0.03 };
function hipRegion(fig, hipSegs) {
  const mat = (m) => new THREE.Matrix4().set(...m, 0, 0, 0, 1);
  let mesh = null, busy = false, pending = null, seq = 0;
  const pickOf = Object.fromEntries(['leftHip', 'rightHip'].map((j) => { const o = new THREE.Object3D(); o.userData = { fig, joint: j }; return [j, o]; }));
  const gen = (fig.hipRegion = {});
  const worker = new Worker(new URL('./doll-worker.js', import.meta.url), { type: 'module' });
  const inv = new THREE.Matrix4(), Mj = new THREE.Matrix4(), Q = new THREE.Quaternion(), I = new THREE.Quaternion(), P = V(0, 0, 0), S = V(1, 1, 1);
  let last = '', timer = null;
  const build = () => {
    timer = null;
    fig.root.updateMatrixWorld(true);
    inv.copy(fig.j.hips.matrixWorld).invert();
    const parts = [], clip = [];
    for (const sg of hipSegs) {
      // 部品の骨の座標 → 腰の座標
      Mj.multiplyMatrices(inv, fig.j[sg.joint].matrixWorld);
      if (sg.hip === 'glute') {
        // 股関節の位置はそのまま、回転だけ GLUTE_FOLLOW の割合に
        Mj.decompose(P, Q, S);
        Mj.compose(P, Q.copy(I).slerp(Q, GLUTE_FOLLOW), S);
      }
      const toPart = Mj.clone().invert();
      for (const pt of sg.parts) {
        const m = mat(pt.m).multiply(toPart).elements;
        const box = new THREE.Box3(V(...pt.box.slice(0, 3)), V(...pt.box.slice(3))).applyMatrix4(Mj);
        parts.push({ ...pt, m: [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]], box: [...box.min.toArray(), ...box.max.toArray()], role: sg.hip, side: sg.joint.startsWith('left') ? 1 : sg.joint.startsWith('right') ? -1 : 0 });
      }
      // 平面の切り取りは部品の骨の座標から腰の座標へ移す（太ももの膝の側）
      for (const c of sg.clip) {
        if (c[0] !== 0) continue;
        const n = V(c[1], c[2], c[3]), p0 = n.clone().multiplyScalar(c[4]).applyMatrix4(Mj);
        n.transformDirection(Mj);
        clip.push([0, n.x, n.y, n.z, n.dot(p0), c[5]]);
      }
    }
    const edges = [];
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b2 = parts[j];
      let k = K_HIP[[a.role, b2.role].sort().join('|')] ?? 0.03;
      if (a.role === b2.role && a.role === 'thigh' && a.side === b2.side) k = Math.max(0.03, a.jk ?? 0, b2.jk ?? 0);
      if (a.side * b2.side < 0) k = a.role === 'pelvis' || b2.role === 'pelvis' ? k : 0;
      if (k > 0) edges.push([i, j, k, k, 0, 0, 0, 0]);
    }
    // 太ももの膝の側の切り取りは、その太ももの形だけに効かせたいので、膝より下の範囲を格子から外す（切り取りは両方の膝に効くが、膝の外は形が無い）
    const box = new THREE.Box3();
    for (const p of parts) box.union(new THREE.Box3(V(...p.box.slice(0, 3)), V(...p.box.slice(3))));
    box.expandByScalar(0.05);
    const cell = 0.0065, min = box.min.toArray();
    const n = box.max.toArray().map((x, i) => Math.ceil((x - min[i]) / cell) + 1);
    // 面の取り出しは Worker で（UI を止めない）。返ってくる前に次の姿勢が来たら、返ってきた時点の最新だけ取り出し直す
    const job = { parts: parts.map(({ kind, m, p, box, mesh }) => ({ kind, m, p, box, mesh })), edges, grid: { min, n, cell, g: null }, clip };
    if (busy) { pending = job; return; }
    send(job);
  };
  const send = (job) => {
    busy = true;
    worker.postMessage({ id: ++seq, ...job });
  };
  worker.onmessage = ({ data: m }) => {
    busy = false;
    // 人形が組み直された後に返ってきた古い形は捨てる
    if (fig.hipRegion !== gen) return worker.terminate();
    show(m);
    if (pending) { const j = pending; pending = null; send(j); }
  };
  const show = (m) => {
    // 形を作るたびに部品を作り替える（同じ geometry の属性を差し替えると、輪郭線の部品と描画が食い違った）
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    // 三角形を腰と左右の太ももに振り分け、group ごとに材質を分ける（選んだ太ももだけ色を変え、当たった面の group で選ぶ）
    fig.root.updateMatrixWorld(true);
    const idx = m.index, pos = m.position, toW = fig.j.hips.matrixWorld, c = V(0, 0, 0), l = V(0, 0, 0);
    const toThigh = HIP_JOINTS.slice(1).map((j) => fig.j[j].matrixWorld.clone().invert().multiply(toW));
    const tris = [[], [], []];
    for (let t = 0; t < idx.length; t += 3) {
      c.set(0, 0, 0);
      for (let k = 0; k < 3; k++) c.x += pos[idx[t + k] * 3], c.y += pos[idx[t + k] * 3 + 1], c.z += pos[idx[t + k] * 3 + 2];
      c.multiplyScalar(1 / 3);
      let gi = 0;
      toThigh.forEach((M, i) => { l.copy(c).applyMatrix4(M); if (l.y < -0.04 && Math.hypot(l.x, l.z) < 0.14) gi = i + 1; });
      tris[gi].push(idx[t], idx[t + 1], idx[t + 2]);
    }
    g.setIndex(new THREE.BufferAttribute(Uint32Array.from(tris.flat()), 1));
    let at = 0;
    tris.forEach((tr, i) => { g.addGroup(at, tr.length, i); at += tr.length; });
    const old = mesh;
    mesh = fig.mesh(g, fig.j.hips, [0, 0, 0], [1, 1, 1], 'hips');
    mesh.userData.groupJoints = HIP_JOINTS;
    mesh.material = HIP_JOINTS.map(() => mesh.material);
    mesh.onBeforeRender = watch;
    const cast = mesh.raycast.bind(mesh);
    mesh.raycast = (ray, out) => {
      const n0 = out.length;
      cast(ray, out);
      for (let i = n0; i < out.length; i++) {
        const j = HIP_JOINTS[out[i].face.materialIndex];
        if (j !== 'hips') out[i] = { ...out[i], object: pickOf[j] };
      }
    };
    if (old) {
      mesh.material = old.material;
      old.removeFromParent();
      old.geometry.dispose();
      fig.meshes.splice(fig.meshes.indexOf(old), 1);
    }
  };
  // 股関節の角度が変わったら組み直す。ドラッグ中も THROTTLE ms ごとに組み直してついていく（止まるのを待つと動かしている間ついてこない）
  let lastBuild = 0;
  const THROTTLE = 30;
  const watch = () => {
    const key = ['leftHip', 'rightHip'].map((j) => fig.j[j].quaternion.toArray().map((x) => x.toFixed(3)).join()).join('|');
    if (key === last) return;
    last = key;
    clearTimeout(timer);
    const wait = THROTTLE - (performance.now() - lastBuild);
    if (wait <= 0) { lastBuild = performance.now(); build(); }
    else timer = setTimeout(() => { lastBuild = performance.now(); build(); }, wait);
  };
  build();
}

const HAND = /(Wrist|Thumb\d|Index\d|Middle\d|Ring\d|Pinky\d)$/;
const PROXY = new THREE.MeshBasicMaterial({ visible: false });

// 複数の骨で曲げる部品。形は parent の骨の座標（静止形）で作り、描く前に頂点を重みで混ぜた骨の動きで動かす
function blendMesh(fig, sg) {
  const { parent = sg.joint, bones, weight, onto = null, spine = null } = sg.blend;
  const g = geometryOf(sg).clone();
  const P0 = g.attributes.position.array.slice(), N0 = g.attributes.normal.array.slice();
  const nv = P0.length / 3, nb = bones.length;
  const W = new Float32Array(nv * nb);
  const p = V(0, 0, 0);
  for (let v = 0; v < nv; v++) {
    const w = weight(p.fromArray(P0, 3 * v));
    const t = w.reduce((a, x) => a + x, 0) || 1;
    for (let i = 0; i < nb; i++) W[v * nb + i] = w[i] / t;
  }
  // onto: 楕円体（中心 c、半径 r、静止形の parent の座標）の正規化した半径。骨 onto.bones に付いた分だけ、動かした後もこの値に戻す。
  // frame の骨があれば楕円体はその骨と一緒に動く（その骨の動きを戻した座標で測る）
  const K0 = onto && Float32Array.from({ length: nv }, (_, v) => Math.min(onto.kmax ?? Infinity, Math.hypot((P0[3 * v] - onto.c.x) / onto.r.x, (P0[3 * v + 1] - onto.c.y) / onto.r.y, (P0[3 * v + 2] - onto.c.z) / onto.r.z)));
  const mesh = fig.mesh(g, fig.j[parent], [0, 0, 0], [1, 1, 1], sg.joint);
  mesh.userData.joints = bones.map(([j]) => j);
  mesh.frustumCulled = false;
  for (const c of mesh.children) c.frustumCulled = false;
  const rest = bones.map(([, o]) => new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z));
  // 骨の第 3 要素 { rot }: 骨の回転のうち皮膚へ渡す割合（骨の位置の動きは全部渡す）
  const part = bones.map(([, o, opt]) => opt?.rot != null && { o, rot: opt.rot });
  const Q = new THREE.Quaternion(), I = new THREE.Quaternion(), Pz = V(0, 0, 0), Sz = V(1, 1, 1);
  const M = bones.map(() => new THREE.Matrix4()), inv = new THREE.Matrix4();
  let last = '';
  mesh.onBeforeRender = () => {
    inv.copy(fig.j[parent].matrixWorld).invert();
    bones.forEach(([j], i) => {
      M[i].multiplyMatrices(inv, fig.j[j].matrixWorld).multiply(rest[i]);
      if (!part[i]) return;
      // 骨の原点の今の位置は保ち、回転だけ単位回転との間へ戻す
      const { o, rot } = part[i];
      const at = o.clone().applyMatrix4(M[i]);
      M[i].decompose(Pz, Q, Sz);
      Q.copy(I).slerp(Q, rot);
      M[i].compose(at, Q, Sz).multiply(rest[i]);
    });
    const key = M.map((m) => m.elements.join()).join();
    if (key === last) return;
    last = key;
    const P = g.attributes.position.array, N = g.attributes.normal.array, E = M.map((m) => m.elements);
    const Fi = onto?.frame != null ? M[onto.frame].clone().invert() : null;
    const S = spine && spineTable(spine, M);
    const sq = new THREE.Quaternion(), sq2 = new THREE.Quaternion(), sv = V(0, 0, 0), sn = V(0, 0, 0);
    for (let v = 0; v < nv; v++) {
      const x = P0[3 * v], y = P0[3 * v + 1], z = P0[3 * v + 2], nx = N0[3 * v], ny = N0[3 * v + 1], nz = N0[3 * v + 2];
      let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
      if (S) {
        // 背骨の骨に付いた分はまとめて背骨の曲線で置く: 高さ y の曲線上の点 + その高さの向きで回した (x, 0, z)
        // rel の骨（肩甲骨）は胸の骨からの差分だけを足すので、その分も背骨の曲線で置く
        let w = 0;
        for (const i of spine.bones) w += W[v * nb + i];
        for (const i of spine.rel ?? []) w += W[v * nb + i];
        if (w > 0) {
          // 表の隣り合う 2 行を補間する（丸めると行の境で段ができる）
          const f = Math.min(S.n - 1.001, Math.max(0, (y - S.y0) / S.dy)), k = Math.floor(f), u = f - k, T = S.t, o = 7 * k, o2 = o + 7;
          sq.set(T[o + 3], T[o + 4], T[o + 5], T[o + 6]).slerp(sq2.set(T[o2 + 3], T[o2 + 4], T[o2 + 5], T[o2 + 6]), u);
          const d = sv.set(x, 0, z).applyQuaternion(sq), nn = sn.set(nx, ny, nz).applyQuaternion(sq);
          const cx = T[o] + (T[o2] - T[o]) * u, cy = T[o + 1] + (T[o2 + 1] - T[o + 1]) * u, cz = T[o + 2] + (T[o2 + 2] - T[o + 2]) * u;
          px += w * (cx + d.x); py += w * (cy + d.y); pz += w * (cz + d.z);
          qx += w * nn.x; qy += w * nn.y; qz += w * nn.z;
        }
      }
      for (let i = 0; i < nb; i++) {
        const w = W[v * nb + i];
        if (w === 0 || (S && spine.bones.includes(i))) continue;
        const e = E[i];
        if (S && spine.rel?.includes(i)) {
          // 肩甲骨の動きのうち胸の骨と違う分（e − 胸）を足す。胸と同じに動く分は背骨の曲線が持つ
          const c = E[spine.end[1]];
          px += w * ((e[0] - c[0]) * x + (e[4] - c[4]) * y + (e[8] - c[8]) * z + e[12] - c[12]);
          py += w * ((e[1] - c[1]) * x + (e[5] - c[5]) * y + (e[9] - c[9]) * z + e[13] - c[13]);
          pz += w * ((e[2] - c[2]) * x + (e[6] - c[6]) * y + (e[10] - c[10]) * z + e[14] - c[14]);
          continue;
        }
        px += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
        py += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
        pz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
        qx += w * (e[0] * nx + e[4] * ny + e[8] * nz);
        qy += w * (e[1] * nx + e[5] * ny + e[9] * nz);
        qz += w * (e[2] * nx + e[6] * ny + e[10] * nz);
      }
      const l = Math.hypot(qx, qy, qz) || 1;
      if (onto) {
        let w = 0;
        for (const i of onto.bones) w += W[v * nb + i];
        if (w > 0) {
          const q = V(px, py, pz);
          if (Fi) q.applyMatrix4(Fi);
          const d = q.clone().sub(onto.c), k = Math.hypot(d.x / onto.r.x, d.y / onto.r.y, d.z / onto.r.z) || 1;
          q.copy(onto.c).addScaledVector(d, 1 + w * (K0[v] / k - 1));
          if (Fi) q.applyMatrix4(M[onto.frame]);
          px = q.x; py = q.y; pz = q.z;
        }
      }
      P[3 * v] = px; P[3 * v + 1] = py; P[3 * v + 2] = pz;
      N[3 * v] = qx / l; N[3 * v + 1] = qy / l; N[3 * v + 2] = qz / l;
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
  };
}

// 部品の体（Figure.build の単純な形）を人形の部品に置き換える。手は Figure の形のまま使う
export function buildDoll(fig) {
  for (const m of [...fig.meshes]) {
    if (HAND.test(m.userData.joint)) continue;
    m.removeFromParent();
    if (!m.geometry.userData.doll && m.geometry.type !== 'SphereGeometry') m.geometry.dispose();
  }
  fig.meshes = fig.meshes.filter((m) => HAND.test(m.userData.joint));
  const { segs, R } = dollSegments(fig);
  const hipSegs = segs.filter((sg) => sg.hip);
  if (hipSegs.length) hipRegion(fig, hipSegs);
  for (const sg of segs) {
    if (sg.hip) continue;
    if (sg.blend) blendMesh(fig, sg);
    else fig.mesh(geometryOf(sg), fig.j[sg.joint], [0, 0, 0], [1, 1, 1], sg.joint);
  }
  // 胴は一つの部品なので、選ぶための見えない形を骨ごとに置く
  const { chest, waist, pelvis } = fig.b;
  for (const [j, pos, sc] of [['hips', [0, -0.02, 0], pelvis], ['spine', [0, 0.07, 0], waist], ['chest', [0, 0.12, 0], chest]]) {
    const m = new THREE.Mesh(fig.meshes[0]?.geometry.type === 'SphereGeometry' ? fig.meshes[0].geometry : new THREE.SphereGeometry(1, 16, 12), PROXY);
    m.position.set(...pos);
    m.scale.set(...sc);
    m.userData = { fig, joint: j, proxy: true };
    fig.j[j].add(m);
    fig.meshes.push(m);
  }
  for (const n of ['left', 'right']) {
    fig.ball(fig.j[`${n}Shoulder`], [0, 0, 0], R.shoulder, `${n}Shoulder`);
    fig.ball(fig.j[`${n}Elbow`], [0, 0, 0], R.elbow, `${n}Elbow`);
    fig.ball(fig.j[`${n}Hip`], [0, 0, 0], R.hip, `${n}Hip`);
    fig.ball(fig.j[`${n}Knee`], [0, 0, 0], R.knee, `${n}Knee`);
    fig.ball(fig.j[`${n}Ankle`], [0, 0, 0], R.ankle, `${n}Ankle`);
  }
}

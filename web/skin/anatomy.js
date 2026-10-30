// 体の中身: 骨・筋・脂肪を、静止形の関節の座標に置いた解析的な形（楕円体・円錐）で表す。
// 寸法は作画用の解剖図程度。男性 178cm・女性 166cm（7.5〜8 頭身）を基準に、体型の値 b で幅・筋・脂肪を変える。
//
// 部位: { id, layer: 'bone'|'muscle', grp, side, joint, chain?, kind, F: 部位の座標 → 静止形, p, k, girdle? }
//   grp: 結合の単位（同じ grp どうしは滑らかに結合、違う grp は parts.js の規則にあるものだけ）
//   side: 1 左 / -1 右 / 0 中央。同じ grp でも左右反対どうしは結合しない
//   chain: 筋の起始から停止までの関節。重みは軸に沿ってこの順に移る
//   girdle: 肩甲帯（鎖骨・肩甲骨と、そこに付く筋）。座標は静止形なので、鎖骨の関節ができたら joint を差し替えるだけでよい
// 脂肪: { regions: [{ C, R, basis, t }], holes } を parts.js で距離場の形に直す
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const D2R = Math.PI / 180;

function basis(origin, Y, Zh) {
  const y = Y.clone().normalize();
  let z = Zh.clone().addScaledVector(y, -Zh.dot(y));
  if (z.lengthSq() < 1e-8) z = (Math.abs(y.x) < 0.9 ? V(1, 0, 0) : V(0, 1, 0)).cross(y);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(origin);
}

export function anatomy(who, b, frames, base) {
  const female = who === 'female';
  const sx = (m, f) => (female ? f : m);
  const wS = (b.sw / base.sw) ** 0.8, wH = (b.hw / base.hw) ** 0.8;
  const mu = Math.min(b.muscle ?? 1, 2) ** 0.9 * sx(1, 0.8);
  // 脂肪は部位ごとに 1 乗〜2 乗で効く。プリセットと倍率を重ねても 3 で頭打ち
  const fat = Math.min(b.fat ?? 1, 3);
  const kb = sx(1, 0.88);
  const prims = [];
  const regions = [];

  const P = (j, x, y, z) => V(x, y, z).applyMatrix4(frames[j]);
  const Dir = (j, x, y, z) => V(x, y, z).transformDirection(frames[j]);
  const rot = (j) => new THREE.Matrix4().extractRotation(frames[j]);

  const add = (id, kind, F, p, o) => prims.push({ id, kind, F, p, layer: o.layer, grp: o.grp, side: o.side ?? 0, joint: o.joint, chain: o.chain, full: o.full, soft: o.soft, k: o.k ?? (o.layer === 'bone' ? 0.014 : /^.\.glute$/.test(o.grp) ? 0.05 : /^(trunk|neck)$/.test(o.grp) ? 0.036 : 0.03), girdle: o.girdle });
  // A から B への円錐（A が太さ r1）。fz は hint 方向の半径の倍率
  const cone = (id, o, A, B, r1, r2, fz = 1, hint = Dir(o.joint, 0, 0, 1)) => add(id, 'cone', basis(A, A.clone().sub(B), hint), [A.distanceTo(B), r1, r2, fz], o);
  // A から B へ伸びる紡錘（楕円体）。rw は幅、rt は hint 方向の厚み
  // 格子（7mm）より薄い板は surface nets で面が絡むので、半分の厚みを 8mm 以上にする
  const spindle = (id, o, A, B, rw, rt, hint, taper = 0) => add(id, 'ell', basis(A.clone().add(B).multiplyScalar(0.5), B.clone().sub(A), hint), [Math.max(rw, 0.008), A.distanceTo(B) / 2, Math.max(rt, 0.008), taper], o);
  // 中心 C の楕円体。向きは関節の座標に、必要なら Euler（度、XYZ）を重ねる
  const blob = (id, o, C, R, e = null, taper = 0) => {
    const F = rot(o.joint);
    if (e) F.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(e[0] * D2R, e[1] * D2R, e[2] * D2R)));
    add(id, 'ell', F.setPosition(C), [...R, taper], o);
  };
  const fatR = (C, R, t, F = new THREE.Matrix4()) => { if (t > 1e-4) regions.push({ C, R, t, F: F.clone().setPosition(C) }); };

  // ---------------- 頭と首
  const H = (x, y, z) => P('head', x, y, z);
  const head = { layer: 'bone', grp: 'head', joint: 'head', k: 0.045 };
  blob('cranium', head, H(0, 0.125, -0.012), [0.072, 0.086, 0.094]);
  blob('face', head, H(0, 0.07, 0.042), [0.058, 0.055, 0.052]);
  blob('brow', head, H(0, 0.112, 0.074), [0.046, 0.013, 0.016]);
  blob('jaw', head, H(0, 0.022, 0.04), [0.05, 0.03, 0.052], [-12, 0, 0]);
  blob('submandibular', { ...head, layer: 'muscle' }, H(0, 0.008, 0.02), [0.042, 0.018, 0.042]);
  blob('chin', head, H(0, 0.008, 0.083), [0.019, 0.015, 0.012]);
  // 鼻: 眉間から先へ細い稜線が下り、先と小鼻で幅が出る
  cone('noseBridge', { ...head, k: 0.01 }, H(0, 0.104, 0.084), H(0, 0.068, 0.103), 0.006, 0.008, 1.2, H(0, 0, 1).sub(H(0, 0, 0)));
  blob('noseTip', { ...head, k: 0.01 }, H(0, 0.064, 0.099), [0.0095, 0.008, 0.009]);
  blob('nostrils', { ...head, k: 0.01 }, H(0, 0.06, 0.09), [0.016, 0.0075, 0.009]);
  for (const [s, n] of [[1, 'L'], [-1, 'R']]) {
    const o = { ...head, side: s };
    cone(`ramus.${n}`, o, H(s * 0.05, 0.078, -0.004), H(s * 0.044, 0.014, 0.018), 0.011, 0.012);
    blob(`cheekbone.${n}`, o, H(s * 0.05, 0.082, 0.052), [0.016, 0.012, 0.022], [0, s * 25, 0]);
    blob(`ear.${n}`, { ...o, k: 0.01 }, H(s * 0.074, 0.085, -0.006), [0.008, 0.027, 0.017], [0, s * 10, 0]);
    blob(`masseter.${n}`, { ...o, layer: 'muscle' }, H(s * 0.044, 0.045, 0.022), [0.011, 0.028, 0.019]);
    blob(`cheek.${n}`, { ...o, layer: 'muscle' }, H(s * 0.036, 0.055, 0.062), [0.02, 0.022, 0.018]);
  }

  const neckO = { layer: 'muscle', grp: 'neck', joint: 'neck', chain: ['chest', 'neck', 'head'] };
  const nr = sx(0.052, 0.046) * ((b.r?.neck ?? base.r.neck) / base.r.neck) * mu ** 0.5;
  cone('neckCore', neckO, V(0, 0.45, -0.022), H(0, 0.04, -0.03), nr, nr * 0.92, 0.95, V(0, 0, 1));
  spindle('neckBack', neckO, V(0, 0.45, -0.07), H(0, 0.065, -0.06), nr * 0.85, nr * 0.5, V(0, 0, -1));
  cone('cervical', { layer: 'bone', grp: 'neck', joint: 'neck', chain: ['chest', 'neck', 'head'] }, H(0, 0.05, -0.025), V(0, 0.49, -0.05), 0.016, 0.017);
  spindle('throat', { layer: 'muscle', grp: 'neck', joint: 'neck', chain: ['chest', 'neck', 'head'] }, V(0, 0.45, 0.04), H(0, 0.0, 0.035), nr * 0.6, nr * 0.45, V(0, 0, 1));
  if (!female) blob('larynx', { layer: 'bone', grp: 'neck', joint: 'neck', k: 0.01 }, V(0, 0.535, 0.045), [0.014, 0.022, 0.012], [-15, 0, 0]);

  // ---------------- 胴の骨
  const chestB = { layer: 'bone', grp: 'trunk', joint: 'chest' };
  const ribW = sx(0.13, 0.112) * wS, ribD = sx(0.098, 0.088);
  blob('ribcage', chestB, V(0, 0.305, -0.01), [ribW, 0.168, ribD], null, 0.42);
  blob('sternum', { ...chestB, k: 0.012 }, V(0, 0.385, ribD * sx(0.8, 0.74)), [0.019, 0.07, 0.012], [-8, 0, 0]);
  blob('c7', { ...chestB, k: 0.008 }, V(0, 0.5, -0.088), [0.013, 0.012, 0.012]);
  cone('thoracic', { layer: 'bone', grp: 'trunk', joint: 'chest', chain: ['spine', 'chest'] }, V(0, 0.5, -0.06), V(0, 0.14, -0.05), 0.016, 0.018);
  cone('thoracicSpinous', { layer: 'bone', grp: 'trunk', joint: 'chest', chain: ['spine', 'chest'], k: 0.01 }, V(0, 0.49, -0.084), V(0, 0.17, -0.088), 0.0065, 0.007);
  cone('lumbar', { layer: 'bone', grp: 'trunk', joint: 'spine', chain: ['hips', 'spine'] }, V(0, 0.15, -0.045), V(0, -0.02, -0.05), 0.02, 0.021);
  cone('lumbarSpinous', { layer: 'bone', grp: 'trunk', joint: 'spine', chain: ['hips', 'spine'], k: 0.01 }, V(0, 0.15, -0.07), V(0, -0.01, -0.068), 0.0065, 0.0065);
  const pw = sx(1, 1.1) * wH;
  const hipsB = { layer: 'bone', grp: 'trunk', joint: 'hips' };
  blob('sacrum', hipsB, V(0, -0.055, -0.078), [0.042 * pw, 0.056, 0.018], [-30, 0, 0], -0.4);
  blob('pubis', hipsB, V(0, -0.085, 0.012), [0.05 * pw, 0.03, 0.04]);
  // 骨盤の周りの肉（殿筋の上部・腸腰筋・下腹）。股関節を包んで腰の幅を作り、腹が袋のように太ももから離れない
  blob('pelvisFlesh', { layer: 'muscle', grp: 'trunk', joint: 'hips' }, V(0, -0.05, -0.018), [b.hw + sx(0.048, 0.055) * mu ** 0.3, 0.07, 0.068]);

  for (const [s, n] of [[1, 'L'], [-1, 'R']]) {
    const T = (x, y, z) => V(s * x, y, z);
    const side = s;
    // 下の肋骨: 横ほど低く、中央へ上がる。胸骨の下で逆 V（肋骨弓）になる
    blob(`ribLow.${n}`, { ...chestB, side }, T(ribW * 0.55, 0.205, -0.012), [ribW * 0.5, 0.085, ribD * 0.8], [0, 0, s * 22]);
    blob(`ribBack.${n}`, { ...chestB, side }, T(0.054, 0.31, -0.056), [0.06, 0.15, 0.048], null, 0.5);
    // 腸骨: 外へ開いた扇。上端が腸骨稜、前の角が上前腸骨棘
    blob(`ilium.${n}`, { ...hipsB, side, k: 0.024 }, T(0.088 * pw, -0.016, -0.004), [0.015, 0.054, 0.072], [0, s * 30, s * -8]);
    blob(`asis.${n}`, { ...hipsB, side, k: 0.02 }, T(0.098 * pw, -0.032, 0.048), [0.01, 0.01, 0.01]);
    blob(`ischium.${n}`, { ...hipsB, side }, T(0.05 * pw, -0.12, -0.03), [0.018, 0.025, 0.02]);
    // 鎖骨: 前へ張り出してから後ろへ戻る S 字を 2 本でつなぐ
    const CL = `${s > 0 ? 'left' : 'right'}Clavicle`, SCA = `${s > 0 ? 'left' : 'right'}Scapula`;
    const g = { layer: 'bone', grp: 'trunk', joint: CL, side, girdle: n, k: 0.02 };
    // 内側 2/3 は前へふくらみ、外側 1/3 は後ろへ反って肩峰へ。外へ向かって少し上がる
    // 骨どうしは小さい k でつなぐ（大きいと継ぎ目が数珠のようにふくらむ）
    const gc = { ...g, k: 0.003 };
    const clavM = T(0.018, 0.446, 0.07), clavB = T(0.07 * wS, 0.454, 0.074), clavA = T(b.sw - 0.02, 0.47, -0.004);
    blob(`clavicleHead.${n}`, gc, clavM, [0.0105, 0.0095, 0.0095]);
    cone(`clavicleMedial.${n}`, gc, clavM, clavB, 0.0085 * kb, 0.0078 * kb);
    cone(`clavicleLateral.${n}`, gc, clavB, clavA, 0.0078 * kb, 0.0085 * kb, 0.8, V(0, 1, 0));
    blob(`acromion.${n}`, { ...g, joint: SCA }, T(b.sw - 0.012, 0.462, -0.012), [0.016, 0.008, 0.015]);
    // 肩甲骨: 背中の上、肋骨の後ろに貼り付く三角の板と、斜めに走る肩甲棘
    // 板は肋骨の背に沿わせて沈め、内側の縁は菱形筋と僧帽筋の下に入る。外へ行くほど前へ回る
    blob(`scapula.${n}`, { ...g, joint: SCA, k: 0.024 }, T(0.092 * wS, 0.36, -0.08), [0.048, 0.068, 0.011], [-6, s * 24, s * 8], -0.35);
    cone(`scapularSpine.${n}`, { ...g, joint: SCA, k: 0.02 }, T(0.055 * wS, 0.405, -0.1), T(b.sw - 0.03, 0.458, -0.04), 0.007, 0.0085, 0.8, V(0, 1, 0.3));
  }

  // ---------------- 胴の筋
  const trunkM = (joint, chain, extra = {}) => ({ layer: 'muscle', grp: 'trunk', joint, chain, ...extra });
  blob('abdomenCore', trunkM('spine'), V(0, 0.1, -0.012), [sx(0.112, 0.08) * (0.5 + 0.5 * wH) * mu ** 0.15, 0.145, sx(0.074, 0.07) * fat ** 0.12]);
  for (const [s, n] of [[1, 'L'], [-1, 'R']]) {
    const T = (x, y, z) => V(s * x, y, z);
    const side = s;
    const ra = sx(0.074, 0.07) * fat ** 0.12;
    // 腹直筋: 白線を挟んで左右に細い帯。肋骨弓の下から恥骨へ、胸の線より奥にある
    // 腹直筋: 白線を挟んで左右に一本ずつの平たい帯。肋骨弓の下から恥骨へ。上が広く下で細る
    spindle(`rectus.${n}`, trunkM('spine', ['hips', 'spine', 'chest'], { side }), T(0.036, 0.29, ribD * 0.7), T(0.02, -0.11, 0.05), 0.036 * mu ** 0.3, 0.0075 * mu ** 0.7 + 0.002, V(0, 0, 1), 0.35);
    spindle(`oblique.${n}`, trunkM('spine', ['hips', 'spine', 'chest'], { side }), T(sx(0.115, 0.084) * wS, 0.2, 0.025), T(sx(0.108, 0.108) * wH, 0.01, 0.025), 0.06, 0.02 * mu, V(s, 0, 0.2));
    spindle(`serratus.${n}`, trunkM('chest', null, { side }), T(ribW * 0.92, 0.33, 0.035), T(ribW * 0.85, 0.22, 0.055), 0.03, 0.012 * mu, V(s, 0, 0.4));
    // 脊柱起立筋: 腰では前へ入り（腰の反り）、背骨の溝を挟んで左右に盛り上がる
    spindle(`erectorLumbar.${n}`, trunkM('spine', ['hips', 'spine', 'chest'], { side }), T(0.032, -0.06, -0.066), T(0.036, 0.25, -0.078), 0.024, 0.022 * mu, V(0, 0, -1));
    spindle(`erectorThoracic.${n}`, trunkM('chest', ['spine', 'chest'], { side }), T(0.04, 0.18, -0.098), T(0.03, 0.48, -0.085), 0.02, 0.016 * mu, V(0, 0, -1));
    // 肩甲帯に付く筋（girdle）。起始・停止とも静止形の座標
    const g = (joint, chain, k) => trunkM(joint, chain, { side, girdle: n, k });
    const arm = `${s > 0 ? 'left' : 'right'}Shoulder`;
    const CL = `${s > 0 ? 'left' : 'right'}Clavicle`, SCA = `${s > 0 ? 'left' : 'right'}Scapula`;
    // 背骨から肩甲骨・鎖骨へ張る筋は、軸の区間 full で胸 → 肩甲骨（鎖骨）へ移す。肩をすくめると斜面ごと上がる
    const toScap = (u0, u1, joint = 'chest') => ({ ...g(joint, ['chest', SCA]), full: [u0, u1] });
    const A = (lat, y, fwd) => P(arm, s * lat, y, fwd);
    // 上部は後頭から首の後ろを下りる部分と、首の付け根から肩先へ張る部分の 2 つ。前から見た首と肩の線は首の中ほどから始まる
    spindle(`trapeziusNeck.${n}`, g('neck', ['chest', 'neck', 'head']), H(s * 0.018, 0.03, -0.075), T(0.03, 0.47, -0.085), 0.022, 0.01 * mu, V(s * 0.3, 0, -1));
    spindle(`trapeziusUpper.${n}`, { ...g('chest', ['chest', CL]), full: [0.25, 0.9] }, T(0.03, 0.525, -0.07), T(b.sw - 0.025, 0.462, -0.03), 0.03, 0.016 * mu, V(s * 0.2, 0.8, -0.55), 0.3);
    spindle(`supraspinatus.${n}`, toScap(0.1, 0.45), T(0.035, 0.5, -0.045), T(b.sw - 0.045, 0.448, -0.05), 0.03, 0.026 * mu ** 0.5, V(0, 1, -0.3));
    spindle(`trapeziusMiddle.${n}`, toScap(0.25, 0.85), T(0.008, 0.44, -0.088), T(b.sw - 0.05, 0.44, -0.062), 0.045, 0.01 * mu ** 0.7, V(0, 0.2, -1), 0.3);
    spindle(`trapeziusLower.${n}`, toScap(0.45, 1), T(0.008, 0.19, -0.09), T(0.065 * wS, 0.41, -0.1), 0.036, 0.009 * mu ** 0.7, V(0, 0, -1), 0.2);
    // 菱形筋: 背骨と肩甲骨の内側の縁の間を埋める。肩甲骨の縁はこの下に沈む
    spindle(`rhomboid.${n}`, toScap(0.3, 0.95), T(0.012, 0.45, -0.088), T(0.06 * wS, 0.3, -0.094), 0.03, 0.012 * mu ** 0.6, V(0, 0, -1));
    // 鎖骨の上のくぼみを埋める肉。鎖骨と一緒に動く（胸に残すと、腕を上げて鎖骨が上がったとき後ろに穴が開いた）
    blob(`supraclavicular.${n}`, g(CL), T(0.07, 0.462, -0.004), [0.04, 0.024, 0.032]);
    spindle(`infraspinatus.${n}`, g(SCA), T(0.065 * wS, 0.31, -0.088), T(0.135 * wS, 0.4, -0.066), 0.036, 0.011 * mu ** 0.7, V(s * -0.5, 0, -1));
    // 小円筋: 肩甲骨の外の縁から上腕骨の頭の後ろへ。腕を開いたとき、背中から腕の内へ張る広背筋・大円筋と三角筋の後ろの間を埋める
    spindle(`teresMinor.${n}`, { ...g(SCA, [SCA, arm]), full: [0.2, 0.8] }, T(0.118 * wS, 0.34, -0.094), A(0.0, -0.012, -0.03), 0.022 * mu ** 0.5, 0.016 * mu ** 0.7, V(0, 0, -1));
    spindle(`teresMajor.${n}`, { ...g(SCA, [SCA, arm]), full: [0.1, 0.6] }, T(0.105 * wS, 0.29, -0.1), A(0.0, -0.07, -0.012), 0.02 * mu ** 0.5, 0.018 * mu, V(0, 0, -1));
    spindle(`latissimusLower.${n}`, g('chest', ['spine', 'chest']), T(0.05, 0.08, -0.098), T(ribW * 0.98, 0.32, -0.06), 0.06, 0.017 * mu, V(s * 0.6, 0, -0.8));
    spindle(`latissimusUpper.${n}`, { ...g('chest', ['chest', arm]), full: [0.1, 0.6] }, T(ribW * 0.96, 0.24, -0.06), A(0.0, -0.075, -0.004), 0.026 * mu ** 0.5, 0.017 * mu, V(s * 0.3, 0, -1));
    // 大胸筋: 鎖骨と胸骨から上腕骨の前へ集まる扇。繊維の束を 4 本並べ、胸骨側は厚く、腕側は腱へ細る（taper）。
    // 束は胸郭の丸みに沿う直線で、胸の外では肋骨の前から腋の前のひだになる。腕側の半分で胸 → 腕へ重みを移す
    const pecIns = A(0.0, -0.07, 0.024);
    const pt = sx(0.017, 0.009) * mu ** 0.8;
    const pecHint = V(s * 0.3, 0.05, 1);
    const pec = (id, O, rw, rt, full = [0.45, 0.95], from = 'chest') => {
      const A0 = O.clone().addScaledVector(O.clone().sub(pecIns).normalize(), 0.02);
      A0.x = s * Math.max(0.006, s * A0.x);
      spindle(id, { ...g(from, [from, arm]), full }, A0, pecIns, rw, rt, pecHint, 0.55);
    };
    // 胸の上の厚い塊。胸骨の縁から胸郭の前に貼り付き、下の縁は外へ上がって腋の前のひだへ続く
    blob(`pectoralisBody.${n}`, g('chest'), T(0.072 * wS, 0.365, ribD * 0.6), [0.068 * wS, 0.062, sx(0.03, 0.016) * mu ** 0.8], [0, s * 24, s * -14]);
    pec(`pectoralisClavicular.${n}`, T(0.05, 0.44, 0.074), 0.026 * mu ** 0.3, pt * 0.6, [0.5, 0.95], CL);
    pec(`pectoralisSternal.${n}`, T(0.03, 0.39, ribD * 0.8), 0.034 * mu ** 0.3, pt * 0.6);
    pec(`pectoralisCostal.${n}`, T(0.04, 0.315, ribD * 0.72), 0.03 * mu ** 0.3, pt * 0.7, [0.4, 0.9]);
    spindle(`sternocleidomastoid.${n}`, { layer: 'muscle', grp: 'neck', joint: 'neck', chain: ['chest', 'neck', 'head'], side, k: 0.012 },
      H(s * 0.05, 0.062, -0.022), T(0.024, 0.448, 0.072), 0.014 * mu ** 0.5, 0.011 * mu, V(s * 0.6, 0, 0.8));
    spindle(`scalenes.${n}`, { layer: 'muscle', grp: 'neck', joint: 'neck', chain: ['chest', 'neck'], side }, T(0.03, 0.56, -0.02), T(0.07, 0.445, 0.01), 0.02, 0.018, V(s, 0, 0.3));
  }

  // ---------------- 腕と脚
  for (const [s, n] of [[1, 'left'], [-1, 'right']]) {
    const N = n === 'left' ? 'L' : 'R';
    const J = (x) => `${n}${x}`;
    const sh = J('Shoulder'), el = J('Elbow'), hp = J('Hip'), kn = J('Knee'), an = J('Ankle');
    const A = (j, lat, y, fwd) => P(j, s * lat, y, fwd);
    const D = (j, lat, y, fwd) => Dir(j, s * lat, y, fwd);
    const side = s;
    const { ua, fa, th, sh: shin } = b;
    const armB = { layer: 'bone', grp: `${N}.arm`, joint: sh, side };
    const armM = (chain = null) => ({ layer: 'muscle', grp: `${N}.arm`, joint: sh, chain, side });
    const foreB = { layer: 'bone', grp: `${N}.fore`, joint: el, side };
    const foreM = (chain = null) => ({ layer: 'muscle', grp: `${N}.fore`, joint: el, chain, side });

    // 上腕
    blob(`humeralHead.${N}`, armB, A(sh, 0.004, 0, 0), [0.025, 0.025, 0.025].map((r) => r * kb));
    cone(`humerus.${N}`, armB, A(sh, 0, -0.02, 0), A(sh, 0, -ua + 0.03, -0.004), 0.012 * kb, 0.013 * kb);
    blob(`epicondyles.${N}`, { ...armB, k: 0.006 }, A(sh, 0, -ua + 0.008, -0.006), [0.031 * kb, 0.013, 0.016]);
    const dm = mu;
    // 三角筋: 鎖骨の外・肩峰・肩甲棘から上腕の外の中ほど（三角筋粗面）へ。先は上腕の筋の中で終わる
    const delIns = A(sh, 0.014, -0.135, 0.004);
    spindle(`deltoidFront.${N}`, { ...armM([J('Clavicle'), sh]), full: [0, 0.4] }, V(s * (b.sw - 0.05), 0.458, 0.034), delIns, 0.022 * dm ** 0.5, 0.016 * dm ** 0.8, D(sh, 0.45, 0, 0.9), 0.45);
    spindle(`deltoidMiddle.${N}`, { ...armM([J('Scapula'), sh]), full: [0, 0.4] }, A(sh, 0.022, 0.036, 0.0), delIns, 0.025 * dm ** 0.5, 0.018 * dm ** 0.8, D(sh, 1, 0, 0), 0.45);
    spindle(`deltoidRear.${N}`, { ...armM([J('Scapula'), sh]), full: [0, 0.4] }, A(sh, -0.006, 0.028, -0.042), delIns, 0.022 * dm ** 0.5, 0.016 * dm ** 0.8, D(sh, 0.45, 0, -0.9), 0.45);
    spindle(`biceps.${N}`, armM([sh, el]), A(sh, 0.0, -0.06, 0.022), A(el, 0.002, -0.025, 0.012), 0.019 * mu ** 0.6, 0.02 * mu, D(sh, 0, 0, 1));
    spindle(`brachialis.${N}`, armM([sh, el]), A(sh, 0.0, -0.12, 0.008), A(el, 0, -0.02, 0.006), 0.024 * mu ** 0.6, 0.014 * mu, D(sh, 0, 0, 1));
    spindle(`tricepsLateral.${N}`, armM([sh, el]), A(sh, 0.012, -0.03, -0.018), A(sh, 0.006, -ua + 0.02, -0.024), 0.019 * mu ** 0.6, 0.019 * mu, D(sh, 0.3, 0, -1));
    spindle(`tricepsLong.${N}`, armM([sh, el]), A(sh, -0.01, -0.04, -0.02), A(el, -0.002, 0.0, -0.024), 0.018 * mu ** 0.6, 0.019 * mu, D(sh, -0.3, 0, -1));

    // 前腕: 前腕の芯（手首の太さ）は体と手の両方にあり、手首から 3cm の所で入れ替わる（parts.js の mod）
    blob(`olecranon.${N}`, { ...foreB, k: 0.016 }, A(el, -0.004, 0.004, -0.027), [0.012, 0.017, 0.011].map((r) => r * kb));
    cone(`radius.${N}`, foreB, A(el, 0.012, -0.012, 0.006), A(el, 0.0, -fa + 0.045, 0.012), 0.009 * kb, 0.009 * kb);
    cone(`ulna.${N}`, foreB, A(el, -0.006, 0.0, -0.02), A(el, -0.004, -fa + 0.045, -0.012), 0.009 * kb, 0.007 * kb);
    spindle(`flexors.${N}`, foreM([sh, el]), A(el, -0.03, 0.01, 0.0), A(el, -0.012, -fa * 0.68, 0.0), 0.021 * mu ** 0.5, 0.017 * mu, D(el, -1, 0, 0));
    spindle(`extensors.${N}`, foreM([sh, el]), A(el, 0.03, 0.005, -0.004), A(el, 0.012, -fa * 0.66, -0.006), 0.019 * mu ** 0.5, 0.015 * mu, D(el, 1, 0, 0));
    spindle(`brachioradialis.${N}`, foreM([sh, el]), A(sh, 0.022, -ua + 0.07, 0.006), A(el, 0.008, -fa * 0.6, 0.016), 0.015 * mu ** 0.5, 0.016 * mu, D(el, 0.7, 0, 0.7));

    // 太もも
    const thighB = { layer: 'bone', grp: `${N}.thigh`, joint: hp, side };
    const thighM = (chain = null, extra = {}) => ({ layer: 'muscle', grp: `${N}.thigh`, joint: hp, chain, side, ...extra });
    blob(`femoralHead.${N}`, thighB, A(hp, 0, 0, 0), [0.024, 0.024, 0.024].map((r) => r * kb));
    cone(`femurNeck.${N}`, thighB, A(hp, 0, 0, 0), A(hp, 0.055, -0.055, -0.004), 0.015 * kb, 0.017 * kb);
    blob(`trochanter.${N}`, thighB, A(hp, 0.064, -0.064, -0.01), [0.019, 0.026, 0.021].map((r) => r * kb));
    cone(`femur.${N}`, thighB, A(hp, 0.05, -0.08, 0), A(hp, 0.004, -th + 0.035, -0.002), 0.014 * kb, 0.015 * kb);
    blob(`condyles.${N}`, thighB, A(hp, 0, -th + 0.012, -0.01), [0.036, 0.024, 0.026].map((r) => r * kb));
    // 太ももの付け根の太い肉。大転子の外から内転筋の付け根まで、胴の肉へ広くつながる
    spindle(`thighTop.${N}`, thighM([hp, kn]), A(hp, 0.02, 0.0, 0.0), A(hp, 0.006, -0.22, 0.006), 0.062 * mu ** 0.4, 0.058 * mu ** 0.4, D(hp, 0, 0, 1));
    spindle(`thighCore.${N}`, thighM([hp, kn]), A(hp, 0.02, -0.05, 0.0), A(hp, 0.0, -th + 0.06, 0.008), 0.042 * mu ** 0.5, 0.042 * mu ** 0.5, D(hp, 0, 0, 1));
    spindle(`rectusFemoris.${N}`, thighM([hp, kn]), A(hp, 0.02, -0.04, 0.05), A(kn, 0, 0.045, 0.045), 0.025 * mu ** 0.6, 0.022 * mu, D(hp, 0, 0, 1));
    spindle(`vastusLateralis.${N}`, thighM([hp, kn]), A(hp, 0.05, -0.09, 0.012), A(kn, 0.035, 0.06, 0.02), 0.03 * mu ** 0.6, 0.025 * mu, D(hp, 0.85, 0, 0.5));
    spindle(`vastusMedialis.${N}`, thighM([hp, kn]), A(hp, -0.01, -th * 0.55, 0.03), A(kn, -0.03, 0.045, 0.025), 0.026 * mu ** 0.6, 0.024 * mu, D(hp, -0.7, 0, 0.7), -0.25);
    spindle(`bicepsFemoris.${N}`, { ...thighM([hp, kn]), full: [0.6, 1] }, A(hp, 0.02, -0.07, -0.05), A(kn, 0.04, -0.035, -0.02), 0.024 * mu ** 0.6, 0.024 * mu, D(hp, 0.3, 0, -1));
    spindle(`semitendinosus.${N}`, { ...thighM([hp, kn]), full: [0.6, 1] }, A(hp, -0.012, -0.075, -0.05), A(kn, -0.032, -0.04, -0.016), 0.025 * mu ** 0.6, 0.025 * mu, D(hp, -0.3, 0, -1));
    // 大腿四頭筋の腱: 太ももの前の筋を膝蓋骨へまとめる平たい帯。膝の上で膝蓋骨が一つだけ浮かないようにする
    spindle(`quadricepsTendon.${N}`, thighM([hp, kn], { k: 0.024 }), A(kn, 0, 0.12, 0.034), A(kn, 0, 0.03, 0.03), 0.034, 0.014 * mu ** 0.5, D(hp, 0, 0, 1));
    spindle(`adductors.${N}`, thighM(['hips', hp]), A(hp, -0.05, -0.06, 0.02), A(hp, -0.028, -th * 0.62, -0.005), 0.03 * mu ** 0.5, 0.028 * mu, D(hp, -1, 0, 0));
    spindle(`sartoriusUpper.${N}`, thighM(['hips', hp], { k: 0.02 }), P('hips', s * 0.1 * pw, -0.05, 0.056), A(hp, -0.012, -th * 0.5, 0.05), 0.011, 0.008 * mu, D(hp, 0, 0, 1));
    spindle(`sartoriusLower.${N}`, thighM([hp, kn], { k: 0.012 }), A(hp, -0.012, -th * 0.5, 0.05), A(kn, -0.04, -0.02, -0.004), 0.011, 0.008 * mu, D(hp, -0.7, 0, 0.7));
    spindle(`tensorFasciae.${N}`, thighM(['hips', hp]), P('hips', s * 0.12 * pw, -0.035, 0.035), A(hp, 0.06, -0.14, 0.012), 0.016, 0.014 * mu, D(hp, 1, 0, 0.3));

    // お尻（左右で結合しない別の grp）
    const glute = { layer: 'muscle', grp: `${N}.glute`, joint: 'hips', chain: ['hips', hp], side };
    spindle(`gluteusMaximus.${N}`, glute, P('hips', s * 0.035, -0.03, -0.086), A(hp, 0.05, -0.13, -0.03), sx(0.068, 0.08) * mu ** 0.5, 0.036 * mu ** 0.8, V(s * 0.2, -0.1, -1), -0.35);
    spindle(`gluteusMedius.${N}`, { ...glute, chain: null }, P('hips', s * 0.09 * pw, 0.025, -0.045), A(hp, 0.06, -0.05, -0.012), 0.045, 0.024 * mu, V(s, 0.2, -0.3));

    // すね
    const shinB = { layer: 'bone', grp: `${N}.shin`, joint: kn, side };
    const shinM = (chain = null) => ({ layer: 'muscle', grp: `${N}.shin`, joint: kn, chain, side });
    blob(`tibiaPlateau.${N}`, shinB, A(kn, 0, -0.022, 0.0), [0.038, 0.02, 0.031].map((r) => r * kb));
    cone(`tibia.${N}`, { ...shinB, k: 0.006 }, A(kn, -0.002, -0.04, 0.008), A(kn, -0.006, -shin + 0.03, 0.0), 0.015 * kb, 0.013 * kb, 1.15);
    blob(`tibialTuberosity.${N}`, { ...shinB, k: 0.012 }, A(kn, 0, -0.07, 0.024), [0.011, 0.014, 0.007]);
    // 膝蓋腱の両脇の脂肪体。膝の前を骨の粒でなく一つの丸みにする
    blob(`kneeFatPad.${N}`, { ...shinM(), k: 0.03 }, A(kn, 0, -0.035, 0.012), [0.04, 0.03, 0.022]);
    // 膝の裏の筋（腓腹筋の起始・ハムストリングの停止）は膝の前後の広い区間で骨を移す。深く曲げたとき膝の裏の皮膚が横へはみ出さない（full）
    // 膝蓋骨は曲げると大腿骨の前を滑るので、太ももの骨に付ける。膝の前の皮膚は太ももとすねで分けるので固定しない（soft）
    blob(`patella.${N}`, { ...thighB, k: 0.012, soft: true }, A(kn, 0, 0.022, 0.033), [0.02, 0.023, 0.008].map((r) => r * kb), [10, 0, 0]);
    cone(`patellarTendon.${N}`, { ...shinB, k: 0.012, soft: true }, A(kn, 0, 0.0, 0.038), A(kn, 0, -0.065, 0.026), 0.009, 0.008, 0.6);
    cone(`fibula.${N}`, shinB, A(kn, 0.034, -0.04, -0.012), A(kn, 0.028, -shin + 0.01, -0.01), 0.007 * kb, 0.006 * kb);
    blob(`fibulaHead.${N}`, shinB, A(kn, 0.036, -0.04, -0.012), [0.011, 0.012, 0.011]);
    blob(`malleolusMedial.${N}`, { ...shinB, k: 0.012 }, A(kn, -0.02, -shin + 0.006, 0.002), [0.011, 0.015, 0.012].map((r) => r * kb));
    blob(`malleolusLateral.${N}`, { ...shinB, k: 0.012 }, A(kn, 0.025, -shin - 0.008, -0.01), [0.01, 0.017, 0.011].map((r) => r * kb));
    cone(`shinCore.${N}`, shinM(), A(kn, 0, -0.04, -0.01), A(kn, 0, -shin + 0.05, -0.008), 0.03 * mu ** 0.4, 0.016, 0.95);
    spindle(`gastrocMedial.${N}`, { ...shinM([hp, kn]), full: [0, 0.4] }, A(kn, -0.022, 0.02, -0.038), A(kn, -0.016, -0.23, -0.046), 0.027 * mu ** 0.6, 0.036 * mu, D(kn, -0.3, 0, -1), 0.45);
    spindle(`gastrocLateral.${N}`, { ...shinM([hp, kn]), full: [0, 0.4] }, A(kn, 0.022, 0.02, -0.036), A(kn, 0.02, -0.19, -0.044), 0.023 * mu ** 0.6, 0.032 * mu, D(kn, 0.3, 0, -1), 0.45);
    spindle(`soleus.${N}`, shinM(), A(kn, 0.0, -0.1, -0.026), A(kn, 0, -shin + 0.08, -0.03), 0.034 * mu ** 0.5, 0.02 * mu, D(kn, 0, 0, -1));
    cone(`achilles.${N}`, { ...shinM([kn, an]), k: 0.01 }, A(kn, 0, -shin + 0.14, -0.034), A(an, 0, -0.035, -0.046), 0.008, 0.009, 0.55, D(kn, 0, 0, 1));
    spindle(`tibialisAnterior.${N}`, shinM(), A(kn, 0.022, -0.05, 0.016), A(kn, 0.012, -shin * 0.72, 0.022), 0.016 * mu ** 0.5, 0.016 * mu, D(kn, 0.5, 0, 0.85));
    spindle(`peroneals.${N}`, shinM(), A(kn, 0.036, -0.06, -0.006), A(kn, 0.03, -shin * 0.72, -0.012), 0.013 * mu ** 0.5, 0.013 * mu, D(kn, 1, 0, 0));

    // 足: 骨（距骨・踵骨・足の甲の骨）を、踵の脂肪の厚い肉・足裏の肉・甲の腱と肉が覆う。土踏まずは内側が浮く
    const footB = { layer: 'bone', grp: `${N}.foot`, joint: an, side, k: 0.016 };
    const footM = { layer: 'muscle', grp: `${N}.foot`, joint: an, side, k: 0.03 };
    blob(`talus.${N}`, footB, A(an, 0, -0.02, 0.004), [0.022, 0.02, 0.03]);
    blob(`calcaneus.${N}`, footB, A(an, 0.002, -0.042, -0.028), [0.018, 0.024, 0.032], [20, 0, 0]);
    spindle(`metatarsals.${N}`, footB, A(an, 0, -0.03, 0.01), A(an, -0.002, -0.062, 0.135), 0.032, 0.012, D(an, 0, 1, 0.25));
    blob(`heelPad.${N}`, footM, A(an, 0.002, -0.054, -0.028), [0.021, 0.023, 0.034], [15, 0, 0]);
    // 足裏: 外側の縁は床に付き、内側（土踏まず）は上へ浮く
    spindle(`soleLateral.${N}`, footM, A(an, 0.016, -0.066, -0.02), A(an, 0.018, -0.066, 0.13), 0.016, 0.013, D(an, 0, 1, 0));
    spindle(`sole.${N}`, footM, A(an, 0.0, -0.06, -0.01), A(an, -0.008, -0.062, 0.13), 0.026, 0.012, D(an, 0, 1, 0));
    spindle(`dorsum.${N}`, footM, A(an, 0.002, -0.012, 0.0), A(an, -0.004, -0.052, 0.14), 0.034, 0.018, D(an, 0, 1, 0.3));
    blob(`footBall.${N}`, footM, A(an, -0.002, -0.06, 0.13), [0.044, 0.02, 0.032], [0, s * -10, 0]);
    // 指は付け根の関節で反る・握る。位置は静止形の足首の座標のまま、骨だけ指の付け根
    const toeM = { ...footM, joint: J('Toe') };
    blob(`toes.${N}`, toeM, A(an, 0.01, -0.066, 0.172), [0.032, 0.012, 0.028], [0, s * -12, 0]);
    blob(`bigToe.${N}`, toeM, A(an, -0.024, -0.064, 0.18), [0.0135, 0.0135, 0.027]);
    // 足首: 腱と肉の柱。くるぶしはこの上の小さな出っ張りになる
    cone(`ankleFlesh.${N}`, { ...shinM(), k: 0.02 }, A(kn, 0, -shin * 0.72, -0.01), A(kn, 0, -shin + 0.005, -0.014), 0.025, 0.026, 1.1, D(kn, 0, 0, 1));

    // 脂肪（腕・脚）
    const R = (j) => rot(j);
    fatR(A(sh, -0.004, -ua * 0.5, -0.03), [0.04, ua * 0.42, 0.04], sx(0.003, 0.011) * fat, R(sh));
    fatR(A(sh, 0, -ua * 0.5, 0), [0.07, ua * 0.6, 0.07], sx(0.003, 0.005) * fat, R(sh));
    fatR(A(el, 0, -fa * 0.25, 0), [0.06, fa * 0.32, 0.06], sx(0.002, 0.004) * fat, R(el));
    fatR(A(hp, 0, -th * 0.5, 0), [0.12, th * 0.6, 0.12], sx(0.003, 0.007) * fat, R(hp));
    fatR(A(hp, 0.065, -0.1, -0.01), [0.075, 0.15, 0.1], sx(0.003, 0.026) * fat, R(hp));
    fatR(A(hp, -0.04, -0.14, 0.0), [0.05, 0.1, 0.07], sx(0.001, 0.007) * fat, R(hp));
    fatR(A(kn, 0, -shin * 0.35, -0.01), [0.07, shin * 0.42, 0.07], sx(0.002, 0.005) * fat, R(kn));
    fatR(A(kn, -0.02, 0.06, 0.02), [0.04, 0.05, 0.04], sx(0.001, 0.005) * fat, R(kn));
    // 膝の前と内の皮下脂肪。骨の粒（膝蓋骨・脛骨の上端）を一つの丸みにまとめる
    fatR(A(kn, 0, -0.01, 0.03), [0.05, 0.07, 0.04], sx(0.002, 0.006) * fat, R(kn));
  }

  // ---------------- 脂肪（胴）
  const T = (x, y, z) => V(x, y, z);
  fatR(T(0, 0.17, 0), [0.25, 0.42, 0.2], sx(0.003, 0.005) * fat);
  fatR(T(0, -0.02, 0.08), [0.13, 0.09, 0.07], sx(0.004, 0.009) * fat ** 1.5);
  fatR(T(0, 0.08, 0.08), [0.14, 0.13, 0.08], sx(0.003, 0.002) * fat ** 2);
  fatR(T(0, 0.6, 0.02), [0.07, 0.1, 0.08], 0.004 * fat);
  // 仙骨の上の脂肪。腰からお尻の上へなだらかにつなぐ
  fatR(T(0, 0.05, -0.09), [0.11, 0.08, 0.05], sx(0.003, 0.013) * fat);
  for (const s of [1, -1]) {
    fatR(T(s * 0.12 * wH, 0.07, -0.02), [0.07, 0.08, 0.1], sx(0.004, 0.0025) * fat ** 1.6);
    fatR(T(s * 0.085 * wH, -0.12, -0.1), [0.095, 0.15, 0.085], sx(0.008, 0.04) * fat);
    fatR(T(s * 0.13 * wH, -0.03, -0.03), [0.06, 0.07, 0.08], sx(0.003, 0.022) * fat);
    // 上前腸骨棘の上（腰を細くした女性で骨の角がくぼみにならないように）
    fatR(T(s * 0.085 * wH, 0.0, 0.07), [0.045, 0.045, 0.04], sx(0, 0.007) * fat);
    if (female) {
      // 胸: 大胸筋の上の脂肪。第 4〜5 肋骨の高さに下側の重い塊、上へなだらかに薄くなる。外へ少し向く
      // 上は細く平らに（taper）、下は丸く重い涙形。外へ 16° 向け、少し下を向く。大胸筋へ広い幅で結合する
      // 下半分の丸い塊（ellipsoid）と、その上から鎖骨の下へなだらかに薄くなる脂肪の厚み。上の縁に段ができない
      const k = (b.bust === true ? 1 : b.bust || 0) * (0.7 + 0.3 * Math.min(fat, 1.6));
      if (k > 0.05) {
        const r = 0.05 * k ** 0.45;
        const C = T(s * (0.088 + r * 0.12), 0.288 - r * 0.2, ribD * 0.86 + 0.004 + r * 0.32);
        // 上の極は細く平らに（taper）、下の極は重く丸い。外へ向き、下の縁は少し前へ出る
        blob(`breast.${s > 0 ? 'L' : 'R'}`, { layer: 'fat', grp: 'trunk', joint: 'chest', side: s, k: 0.03 },
          C.add(T(s * 0.004, 0.006, -r * 0.08)), [r * 1.12, r * 1.22, r * 0.8 * k ** 0.15], [-10, s * 18, s * -4], 0.42);
        fatR(T(s * 0.09, 0.315, ribD * 0.86 + 0.01), [0.06, 0.07, 0.06], 0.012 * k ** 0.8);
      }
    } else {
      fatR(T(s * 0.08, 0.29, 0.09), [0.075, 0.065, 0.055], 0.004 * fat ** 1.5);
    }
  }

  // 手首から先と足は脂肪をほとんど持たない（足の甲は皮膚のすぐ下が骨と腱）
  const holes = ['left', 'right'].flatMap((n) => [[...P(`${n}Wrist`, 0, 0, 0).toArray(), 0.045, 0.09], [...P(`${n}Ankle`, 0, -0.05, 0.07).toArray(), 0.07, 0.13]]);
  return { prims, fat: { base: sx(0.005, 0.008) * fat ** 0.7, regions, holes } };
}

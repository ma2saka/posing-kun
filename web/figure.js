// 人形: 関節の Group 階層と、関節角度の意味づけ（semantic ⇄ Euler）。
// 体は +Z を向き、Y が上。単位はメートルと度。
import * as THREE from 'three';
import { buildDoll } from './doll.js';
import { buildHand } from './hands.js';
import { AC, SC, posturalAxial, updateGirdle } from './girdle.js';

const D2R = Math.PI / 180;

export const BODY = {
  male: {
    color: 0x8c8c8c, scale: 1.0,
    sw: 0.19, hw: 0.09, ua: 0.29, fa: 0.26, th: 0.45, sh: 0.43,
    chest: [0.17, 0.15, 0.11], waist: [0.13, 0.12, 0.095], pelvis: [0.16, 0.10, 0.11],
    r: { ua: [0.048, 0.038], fa: [0.04, 0.028], th: [0.075, 0.05], sh: [0.05, 0.035], neck: 0.05 },
    hand: 1.0, bust: false, muscle: 1, fat: 1,
  },
  female: {
    color: 0xf2f2f2, scale: 0.93,
    sw: 0.16, hw: 0.095, ua: 0.28, fa: 0.25, th: 0.49, sh: 0.46,
    chest: [0.14, 0.14, 0.10], waist: [0.11, 0.11, 0.085], pelvis: [0.17, 0.105, 0.115],
    r: { ua: [0.04, 0.032], fa: [0.033, 0.024], th: [0.08, 0.048], sh: [0.047, 0.03], neck: 0.042 },
    hand: 0.9, bust: true, muscle: 1, fat: 1, hipY: -0.035,
    // 立ち姿の基本（関節の値に上乗せ、度）: 骨盤を pelvis だけ前へ傾け（脚は後ろへ振れる）、股関節を同じだけ曲げて脚はまっすぐ、
    // 腰椎を反らして上体を起こし、胸を張る（お尻が後ろ、胸が前）
    // 値は semantic の先頭から（数なら 1 要素目）。股関節の 2 要素目で脚を少し開いて立つ
    // 女性の胴の S 字は胴の形（doll.js の断面の表）が持つので、骨格は脚を少し開くのと首だけ
    curve: { leftHip: [0, 7], rightHip: [0, 7], neck: 6 },
  },
};

// 関節の種類。semantic の 3 要素の意味:
//   axial    [前屈, 自分の左へ傾く, 自分の左へひねる]
//   clavicle [すくめる（肩先を上げる）, 肩先を前へ出す（負で胸を開く）, -]。胸鎖関節が支点。肩はこの先にぶら下がる
//   shoulder [前へ上げる, 横へ上げる, 内へひねる]
//   elbow    [曲げる, -, 前腕を内へひねる]
//   wrist    [手のひら側へ曲げる, 小指側へ曲げる, 手のひらを内へ返す]
//   hip      [脚を前へ上げる, 外へ開く, 外へひねる]
//   knee     [曲げる, -, -]
//   ankle    [つま先を下げる, 足裏を内へ向ける, つま先を内へ向ける]
//   toe      [指の付け根を反らす（つま先立ち）, -, -]
export const JOINTS = {
  spine: 'axial', chest: 'axial', neck: 'axial', head: 'axial',
  leftClavicle: 'clavicle', leftShoulder: 'shoulder', leftElbow: 'elbow', leftWrist: 'wrist',
  rightClavicle: 'clavicle', rightShoulder: 'shoulder', rightElbow: 'elbow', rightWrist: 'wrist',
  leftHip: 'hip', leftKnee: 'knee', leftAnkle: 'ankle', leftToe: 'toe',
  rightHip: 'hip', rightKnee: 'knee', rightAnkle: 'ankle', rightToe: 'toe',
};

const LIMITS = {
  axial: [[-60, 90], [-45, 45], [-70, 70]],
  clavicle: [[-10, 40], [-30, 30], [0, 0]],
  shoulder: [[-60, 180], [-30, 180], [-90, 90]],
  elbow: [[0, 150], [0, 0], [-90, 90]],
  // 手首: 曲げ伸ばし、横への曲げ、手のひらの返し（前腕のひねりを手首で受ける）
  wrist: [[-70, 80], [-25, 35], [-90, 90]],
  hip: [[-30, 140], [-30, 90], [-45, 60]],
  knee: [[0, 160], [0, 0], [0, 0]],
  // 足首: 体重をかけたしゃがみで 40° 上がり、つま先を伸ばすと甲のしなりまで含めて 75°
  ankle: [[-40, 75], [-20, 30], [-30, 30]],
  // 足の指の付け根: 反らす 90°（つま先立ち・膝つき）、握る 40°
  toe: [[-40, 90], [0, 0], [0, 0]],
};

// kind, 左右の符号 → Euler 各軸が semantic の何番目を何倍で表すか
function axes(kind, s) {
  switch (kind) {
    case 'axial': return { x: [0, 1], z: [1, -1], y: [2, 1] };
    case 'clavicle': return { z: [0, s], y: [1, -s] };
    case 'shoulder': return { x: [0, -1], z: [1, s], y: [2, -s] };
    case 'elbow': return { x: [0, -1], y: [2, -s] };
    case 'wrist': return { z: [0, -s], x: [1, s], y: [2, -s] };
    case 'hip': return { x: [0, -1], z: [1, s], y: [2, s] };
    case 'knee': return { x: [0, 1] };
    case 'ankle': return { x: [0, 1], z: [1, -s], y: [2, -s] };
    case 'toe': return { x: [0, -1] };
  }
}

// 腕の付け根の皮膚の骨が受け持つ上腕のひねりの割合（内へ inner、外へ outer）。ひねりは静止形の腕（58° 開き、skin/parts.js の REST）の向きから
// 最短に振った後の腕の軸まわりの角度。振りが swing（度）、ひねりが tau（度）の範囲で割合を 1 へ戻す（どちらも大きいと振りとひねりの分け方が定まらない）
export const TWIST = { inner: 0.5, outer: 0.3, swing: [80, 130], tau: [110, 160] };
const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const DOWN = new THREE.Vector3(0, -1, 0);

const side = (name) => (name.startsWith('left') ? 1 : name.startsWith('right') ? -1 : 0);

export const gradient = (() => {
  const t = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

// uWarp: キューブ面へ描くときは 1。面の端ほど画素が細かいので線を太らせて、魚眼にしたとき幅をそろえる
export const outlineUniforms = { uRes: { value: new THREE.Vector2(1, 1) }, uPx: { value: 1.6 }, uWarp: { value: 0 } };
// push: 線を視線の奥へずらす距離（m）。皮膚のくぼみで線が表に出ないようにする。SkinnedMesh にも使える
// disp: 皮膚と同じく aDisp / aDispN をスキニングの後に足す
export const outlineMaterial = (push = 0, disp = false) => new THREE.ShaderMaterial({
  uniforms: outlineUniforms,
  side: THREE.BackSide,
  defines: { PUSH: push.toFixed(4), ...(disp ? { DISP: 1 } : {}) },
  vertexShader: `
    uniform vec2 uRes; uniform float uPx, uWarp;
    #include <common>
    #include <skinning_pars_vertex>
    #ifdef DISP
    attribute vec3 aDisp, aDispN;
    #endif
    void main() {
      #include <beginnormal_vertex>
      #include <skinbase_vertex>
      #include <skinnormal_vertex>
      #ifdef DISP
      objectNormal = normalize(objectNormal + aDispN);
      #endif
      #include <begin_vertex>
      #include <skinning_vertex>
      #ifdef DISP
      transformed += aDisp;
      #endif
      vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
      mv.xyz += normalize(mv.xyz) * PUSH;
      vec4 p = projectionMatrix * mv;
      vec4 n = projectionMatrix * vec4(normalize(normalMatrix * objectNormal), 0.0);
      vec2 c = p.xy / max(p.w, 1e-4);
      p.xy += normalize(n.xy) / uRes * uPx * 2.0 * p.w * (1.0 + uWarp * min(dot(c, c), 2.0));
      gl_Position = p;
    }`,
  // 線形の色で書き、出力先の色空間へ変換する（画面では sRGB 0.13、キューブマップへは線形のまま）
  fragmentShader: `
    void main() {
      gl_FragColor = vec4(vec3(0.0153), 1.0);
      #include <colorspace_fragment>
    }`,
});
const outlineMat = outlineMaterial();

export const SPHERE = new THREE.SphereGeometry(1, 32, 20);

export class Figure {
  // 他の機能（体型・手の形など）が状態の保存・復元に加わるための口。{ key, get(fig), set(fig, value) }
  static stateHooks = [];

  constructor(who, body = BODY[who]) {
    this.who = who;
    // 肩甲上腕リズム（腕を上げると鎖骨・肩甲骨も動く）と姿勢。off は関節ごとの semantic への上乗せ（getJoint は差し引いて返す）
    this.rhythm = true;
    this.posture = { chest: 0, shrug: 0, neck: 0 };
    this.off = {};
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    // 骨盤の前傾（体型の curve.pelvis、度）は置き方の回転の内側に足す。置き方の回転（rotation）の値は変えない
    const tilt = new THREE.Matrix4(), updRoot = this.root.updateMatrix.bind(this.root);
    this.root.updateMatrix = () => {
      updRoot();
      const p = this.b?.curve?.pelvis ?? 0;
      if (p) this.root.matrix.multiply(tilt.makeRotationX(p * D2R));
    };
    this.mat = new THREE.MeshToonMaterial({ color: body.color, gradientMap: gradient });
    this.setBody(body);
    this.root.position.y = (this.b.th + this.b.sh + 0.13) * this.b.scale;
  }

  // 体型を差し替えて組み直す。姿勢（関節角度と root）は保つ
  setBody(body) {
    const keep = this.b ? this.getState() : null;
    for (const c of [...this.root.children]) this.root.remove(c);
    for (const m of this.meshes ?? []) if (m.geometry !== SPHERE) m.geometry.dispose();
    this.b = body;
    this.mat.color.setHex(body.color);
    this.root.scale.setScalar(body.scale);
    this.j = { hips: this.root };
    this.base = {};
    this.off = {};
    this.meshes = [];
    this.scapW = (body.sw / BODY[this.who].sw) ** 0.8;
    this.build();
    this.setPosture(this.posture);
    if (keep) this.setState(keep);
    this.root.updateMatrixWorld(true);
  }

  joint(name, parent, pos) {
    const g = new THREE.Group();
    g.position.set(...pos);
    g.rotation.order = 'XZY';
    g.name = name;
    parent.add(g);
    this.j[name] = g;
    return g;
  }

  mesh(geo, parent, pos, scale = [1, 1, 1], joint = parent.name || 'hips') {
    const m = new THREE.Mesh(geo, this.mat);
    m.position.set(...pos);
    m.scale.set(...scale);
    m.userData = { fig: this, joint };
    const o = new THREE.Mesh(geo, outlineMat);
    o.raycast = () => {};
    m.add(o);
    parent.add(m);
    this.meshes.push(m);
    return m;
  }

  ball(parent, pos, r, joint) { return this.mesh(SPHERE, parent, pos, [r, r, r], joint); }

  limb(parent, len, [r1, r2]) {
    const geo = new THREE.CylinderGeometry(r1, r2, len, 24, 1, true);
    this.mesh(geo, parent, [0, -len / 2, 0]);
    this.ball(parent, [0, 0, 0], r1 * 0.98);
  }

  build() {
    const b = this.b;
    const hips = this.root;
    hips.name = 'hips';
    this.mesh(SPHERE, hips, [0, -0.02, 0], b.pelvis);
    const spine = this.joint('spine', hips, [0, 0.08, 0]);
    this.mesh(SPHERE, spine, [0, 0.07, 0], b.waist);
    const chest = this.joint('chest', spine, [0, 0.15, 0]);
    this.mesh(SPHERE, chest, [0, 0.12, 0], b.chest);
    if (b.bust) {
      const k = b.bust === true ? 1 : b.bust;
      const r = 0.052 * k;
      for (const x of [-1, 1]) this.ball(chest, [x * (b.chest[0] * 0.39 + (r - 0.052) * 0.5), 0.1 - (r - 0.052) * 0.5, b.chest[2] * 0.72 + (r - 0.052) * 0.6], r);
    }
    const neck = this.joint('neck', chest, [0, 0.25, 0]);
    this.mesh(new THREE.CylinderGeometry(b.r.neck, b.r.neck * 1.15, 0.12, 20, 1, true), neck, [0, 0.04, 0]);
    const head = this.joint('head', neck, [0, 0.09, 0]);
    this.mesh(SPHERE, head, [0, 0.1, 0.01], [0.088, 0.115, 0.1]);
    this.mesh(SPHERE, head, [0, 0.07, 0.1], [0.012, 0.02, 0.014]);

    for (const [s, n] of [[1, 'left'], [-1, 'right']]) {
      // 鎖骨（胸鎖関節が支点）→ 肩の土台（肩関節の位置、鎖骨の回転を打ち消す）→ 肩。肩甲骨は肩鎖関節に付く（皮膚の骨。JOINTS には無い）
      const sc = SC(s), ac = AC(s, b.sw);
      const cl = this.joint(`${n}Clavicle`, chest, sc);
      this.joint(`${n}Scapula`, cl, [ac[0] - sc[0], ac[1] - sc[1], ac[2] - sc[2]]);
      const lat = [s * b.sw - sc[0], 0.21 - sc[1], -sc[2]];
      const len = Math.hypot(...lat);
      // 肩のかたまり（僧帽筋・三角筋の肉）: 胸の中から肩の球へ太さをつなぐ、前後に少し平たい円錐台
      const r2 = b.r.ua[0] * 1.15, r1 = r2 * 1.15;
      const block = this.mesh(new THREE.CylinderGeometry(r2, r1, len, 20, 1, true), cl, lat.map((x) => x / 2));
      block.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...lat).normalize());
      block.scale.set(1, 1, 0.8);
      this.mesh(SPHERE, cl, [0, 0, 0], [r1, r1, r1 * 0.8]);
      const base = new THREE.Group();
      base.name = `${n}ShoulderBase`;
      base.position.set(...lat);
      cl.add(base);
      this.base[n] = base;
      const update = cl.updateMatrix;
      cl.updateMatrix = () => { updateGirdle(this, n); update.call(cl); };
      const sh = this.joint(`${n}Shoulder`, base, [0, 0, 0]);
      // 腕の付け根の皮膚の骨: 肩と同じ向きで、上腕のひねりだけ TWIST の割合。付け根から肘へ重みを移す（skin/mesh.js）
      const shr = this.joint(`${n}ShoulderRoot`, base, [0, 0, 0]);
      const updRoot = shr.updateMatrix;
      const Q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, s * THREE.MathUtils.degToRad(58), 'XZY'));
      const Q0i = Q0.clone().invert(), d0 = DOWN.clone().applyQuaternion(Q0);
      const d = new THREE.Vector3(), T = new THREE.Quaternion(), tw = new THREE.Quaternion();
      shr.updateMatrix = () => {
        d.copy(DOWN).applyQuaternion(sh.quaternion);
        T.setFromUnitVectors(d0, d).invert().multiply(sh.quaternion).multiply(Q0i);
        const tau = THREE.MathUtils.euclideanModulo(2 * Math.atan2(T.x * d0.x + T.y * d0.y + T.z * d0.z, T.w) + Math.PI, 2 * Math.PI) - Math.PI;
        const k = s * tau > 0 ? TWIST.inner : TWIST.outer;
        const deg = THREE.MathUtils.radToDeg;
        const g = (1 - k) * tau * (1 - smooth(...TWIST.swing, deg(d0.angleTo(d)))) * (1 - smooth(...TWIST.tau, Math.abs(deg(tau))));
        shr.quaternion.copy(sh.quaternion).multiply(tw.setFromAxisAngle(DOWN, -g));
        updRoot.call(shr);
      };
      this.ball(sh, [0, 0, 0], b.r.ua[0] * 1.15);
      this.limb(sh, b.ua, b.r.ua);
      const el = this.joint(`${n}Elbow`, sh, [0, -b.ua, 0]);
      this.limb(el, b.fa, b.r.fa);
      const wr = this.joint(`${n}Wrist`, el, [0, -b.fa, 0]);
      this.ball(wr, [0, 0, 0], b.r.fa[1]);
      buildHand(this, wr, s, n);

      // 股関節の高さ（腰の座標）。女性は骨盤が浅く股の位置が高い
      const hp = this.joint(`${n}Hip`, hips, [s * b.hw, b.hipY ?? -0.06, 0]);
      this.limb(hp, b.th, b.r.th);
      const kn = this.joint(`${n}Knee`, hp, [0, -b.th, 0]);
      this.limb(kn, b.sh, b.r.sh);
      const an = this.joint(`${n}Ankle`, kn, [0, -b.sh, 0]);
      this.ball(an, [0, 0, 0], b.r.sh[1]);
      this.mesh(SPHERE, an, [0, -0.045, 0.045], [0.045, 0.035, 0.105]);
      // 足の指の付け根（母指球の下）。指は付け根から先へ
      const toe = this.joint(`${n}Toe`, an, [0, -0.062, 0.157]);
      this.mesh(SPHERE, toe, [0, -0.002, 0.022], [0.04, 0.016, 0.034]);
    }
    buildDoll(this);
  }

  // ---- semantic ⇄ 回転
  setJoint(name, sem, clamp = true) {
    const kind = JOINTS[name];
    const g = this.j[name];
    const lim = LIMITS[kind];
    const cur = this.getJoint(name);
    const off = this.off[name] ?? [0, 0, 0];
    const want = [0, 1, 2].map((i) => sem[i] ?? cur[i]);
    const lo = lim.map((l) => l[0]);
    // 肩の前後の回転は横への上げより外側にかかるので、腕を横へ上げた状態から肘を後ろへ回す（投球の構え）には後ろへ大きく振る必要がある。
    // 後ろの限界を横への上げ具合で広げる（下ろした腕は -60°、横 50° 以上で -120°。横 45°・後ろ 90° で肘が肩の 16cm 後ろ）
    if (kind === 'shoulder') lo[0] -= 60 * smooth(10, 50, want[1]);
    const v = [0, 1, 2].map((i) => (clamp ? Math.min(lim[i][1], Math.max(lo[i], want[i])) : want[i]) + off[i]);
    const e = { x: 0, y: 0, z: 0 };
    for (const [ax, [i, k]] of Object.entries(axes(kind, side(name)))) e[ax] = v[i] * k * D2R;
    g.rotation.set(e.x, e.y, e.z);
  }

  getJoint(name) {
    const kind = JOINTS[name];
    const r = this.j[name].rotation;
    const v = [0, 0, 0];
    for (const [ax, [i, k]] of Object.entries(axes(kind, side(name)))) v[i] = r[ax] / D2R / k;
    const off = this.off[name];
    return off ? v.map((x, i) => x - off[i]) : v;
  }

  // 姿勢: { chest: -1 背を丸める … +1 胸を開く, shrug: 0..1 肩をすくめる, neck: 0..1 首を前へ出す }。
  // 体幹の関節へは semantic の上乗せとして入れ、関節の値（getJoint）は変えない。鎖骨の分は updateGirdle が入れる
  setPosture(p) {
    this.posture = { chest: 0, shrug: 0, neck: 0, ...p };
    const add = Object.fromEntries(Object.entries(posturalAxial(this.posture)).map(([n, x]) => [n, [x, 0, 0]]));
    for (const [n, x] of Object.entries(this.b.curve ?? {})) {
      if (!(n in JOINTS)) continue;
      const a = add[n] ??= [0, 0, 0];
      [x].flat().forEach((v, i) => { a[i] += v; });
    }
    for (const [n, x] of Object.entries(add)) {
      const v = this.getJoint(n);
      this.off[n] = x;
      this.setJoint(n, v, false);
    }
    this.root.updateMatrixWorld(true);
  }

  getState() {
    const r = this.root;
    const joints = {};
    for (const n of Object.keys(JOINTS)) {
      const v = this.getJoint(n).map((x) => Math.round(x));
      if (v.some((x) => x !== 0)) joints[n] = v;
    }
    const st = {
      pos: r.position.toArray().map((x) => +x.toFixed(3)),
      rot: [r.rotation.x, r.rotation.y, r.rotation.z].map((x) => Math.round(x / D2R)),
      joints,
    };
    for (const h of Figure.stateHooks) st[h.key] = h.get(this);
    return st;
  }

  setState(st) {
    if (st.pos) this.root.position.fromArray(st.pos);
    if (st.rot) this.root.rotation.set(st.rot[0] * D2R, st.rot[1] * D2R, st.rot[2] * D2R);
    if (st.joints) {
      for (const n of Object.keys(JOINTS)) this.setJoint(n, [0, 1, 2].map((i) => st.joints[n]?.[i] ?? 0), false);
    }
    for (const h of Figure.stateHooks) if (st[h.key] !== undefined) h.set(this, st[h.key]);
    this.root.updateMatrixWorld(true);
  }

  // ---- 部位の位置（ワールド座標）
  part(name) {
    const b = this.b;
    const P = {
      head: ['head', [0, 0.11, 0]], face: ['head', [0, 0.09, 0.1]], mouth: ['head', [0, 0.04, 0.09]],
      backOfHead: ['head', [0, 0.11, -0.1]], neck: ['neck', [0, 0.04, 0]],
      chest: ['chest', [0, 0.11, b.chest[2]]], back: ['chest', [0, 0.11, -b.chest[2]]],
      shoulders: ['chest', [0, 0.21, 0]], belly: ['spine', [0, 0.06, b.waist[2]]], waist: ['spine', [0, 0.04, 0]],
      hips: ['hips', [0, 0, 0]], butt: ['hips', [0, -0.05, -b.pelvis[2]]], pelvisFront: ['hips', [0, -0.06, b.pelvis[2] * 0.8]],
    };
    for (const n of ['left', 'right']) {
      P[`${n}Shoulder`] = [`${n}Shoulder`, [0, 0, 0]];
      P[`${n}Elbow`] = [`${n}Elbow`, [0, 0, 0]];
      P[`${n}Hand`] = [`${n}Wrist`, [0, -0.08 * b.hand, 0]];
      P[`${n}Hip`] = [`${n}Hip`, [0, 0, 0]];
      P[`${n}Thigh`] = [`${n}Hip`, [0, -b.th * 0.55, 0]];
      P[`${n}Knee`] = [`${n}Knee`, [0, 0, 0]];
      P[`${n}Shin`] = [`${n}Knee`, [0, -b.sh * 0.5, 0]];
      P[`${n}Foot`] = [`${n}Ankle`, [0, -0.04, 0.06]];
      // 腰の横（腸骨の上、手を当てる所）と頬（頬杖）
      const sx = n === 'left' ? 1 : -1;
      P[`${n}Waist`] = ['hips', [sx * b.pelvis[0] * 0.95, 0.06, 0]];
      P[`${n}Cheek`] = ['head', [sx * 0.07, 0.05, 0.06]];
    }
    this.root.updateMatrixWorld(true);
    if (name === 'lap') {
      const v = this.part('leftThigh').add(this.part('rightThigh')).multiplyScalar(0.5);
      return v.add(new THREE.Vector3(0, b.r.th[0] * b.scale, 0));
    }
    const p = P[name];
    if (!p) throw new Error(`unknown part: ${name}`);
    return this.j[p[0]].localToWorld(new THREE.Vector3(...p[1]));
  }

  // 見えている体の範囲（ワールド座標）。皮膚の機能が差し替える
  box() {
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const m of this.meshes) box.expandByObject(m, true);
    return box;
  }

  ground() {
    this.root.position.y -= this.box().min.y;
    this.root.updateMatrixWorld(true);
  }

  setTint(joint) {
    for (const m of this.meshes) {
      if (m.userData.proxy) continue;
      if (m.userData.groupJoints) { m.material = m.userData.groupJoints.map((j) => (j === joint ? this.hiMat() : this.mat)); continue; }
      m.material = m.userData.joint === joint || m.userData.joints?.includes(joint) ? this.hiMat() : this.mat;
    }
  }

  hiMat() {
    this._hi ??= new THREE.MeshToonMaterial({ color: 0xd9a35a, gradientMap: gradient });
    return this._hi;
  }
}

export const PARTS = [
  'head', 'face', 'mouth', 'backOfHead', 'neck', 'shoulders', 'chest', 'back', 'belly', 'waist', 'hips', 'butt', 'pelvisFront', 'lap',
  ...['left', 'right'].flatMap((n) => ['Shoulder', 'Elbow', 'Hand', 'Hip', 'Thigh', 'Knee', 'Shin', 'Foot', 'Waist', 'Cheek'].map((p) => n + p)),
];

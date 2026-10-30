// IK ハンドル: 手足・肘・膝・腰・胸・背中・視線のハンドルをドラッグして姿勢を作る。
// 肘・膝のハンドルは手首・足首を止めたまま、腕・脚を肩（股）と手首（足首）を結ぶ軸の周りに回す。
import { reach } from '../ops.js';

const CHAIN = {
  leftHand: ['leftShoulder', 'leftElbow', 'leftWrist'], rightHand: ['rightShoulder', 'rightElbow', 'rightWrist'],
  leftFoot: ['leftHip', 'leftKnee', 'leftAnkle'], rightFoot: ['rightHip', 'rightKnee', 'rightAnkle'],
};
// 肘・膝のハンドル → その手足
const POLE = { leftElbow: 'leftHand', rightElbow: 'rightHand', leftKnee: 'leftFoot', rightKnee: 'rightFoot' };
// 手先・足先のアンカー → その手首・足首。手首・足首を選んでいる間だけ出し、引くと手首・足首の位置は保ったまま手・足の向きを変える
const TIP = { leftHandTip: 'leftWrist', rightHandTip: 'rightWrist', leftFootTip: 'leftAnkle', rightFootTip: 'rightAnkle' };
const TIP_SCALE = 0.7;
const KINDS = [...Object.keys(CHAIN), ...Object.keys(POLE), ...Object.keys(TIP), 'hips', 'back', 'front', 'head'];
const COLOR = { limb: 0x1f6fd1, pole: 0x6fb4ff, tip: 0x13a3b5, hips: 0xc8501e, back: 0x8a3fc1, front: 0xc0398a, head: 0x2a8f4a };
// chest ローカルでの胴のハンドル。背中は肩甲骨の間、胸は胸骨の前（どちらも皮膚の外）
const TORSO = { back: [0, 0.17, -0.15], front: [0, 0.15, 0.17] };
const BEND = { spine: 0.45, chest: 0.55 }; // 胴の曲げを背と胸に分ける割合
const NECK_COUNTER = 0.15; // 胴を曲げた分のうち首で戻す割合（残りは頭で戻して顔の向きを保つ）
const PX = 7; // ハンドルの半径（画面上の px）
const HIT_PX = 12;
const EYE = [0, 0.1, 0]; // head ローカルでの頭の中心
const GAZE = 0.4; // 視線ハンドルの頭からの距離の既定（head ローカル）
const AIM_W = { chest: 0.3, neck: 0.3, head: 0.4 };
const D2R = Math.PI / 180;

const limbOfJoint = (j) => {
  const m = /^(left|right)(Shoulder|Elbow|Wrist|Fingers|Hip|Knee|Ankle)$/.exec(j ?? '');
  return m && `${m[1]}${/Hip|Knee|Ankle/.test(m[2]) ? 'Foot' : 'Hand'}`;
};

export default function init(ctx) {
  const { THREE, scene, camera, canvas, orbit, figs } = ctx;
  const V = (...a) => new THREE.Vector3(...a);
  const wpos = (o) => o.getWorldPosition(V());
  const { clamp } = THREE.MathUtils;

  const group = new THREE.Group();
  scene.add(group);
  const geo = new THREE.SphereGeometry(1, 16, 10);
  const mat = (color) => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 });
  const mats = Object.fromEntries(Object.entries(COLOR).map(([k, c]) => [k, mat(c)]));
  const handles = Object.values(figs).flatMap((fig) => KINDS.map((kind) => {
    const mesh = new THREE.Mesh(geo, mats[CHAIN[kind] ? 'limb' : POLE[kind] ? 'pole' : TIP[kind] ? 'tip' : kind]);
    mesh.renderOrder = 1000;
    group.add(mesh);
    return { fig, kind, mesh };
  }));
  // 書き換えて使う線分。draw([[a, b], ...]) で毎フレーム差し替える
  function segments(color, max) {
    const geo = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(max * 6), 3);
    geo.setAttribute('position', pos);
    const obj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
    obj.renderOrder = 999;
    obj.frustumCulled = false;
    group.add(obj);
    return (segs) => {
      segs.slice(0, max).flat().forEach((v, i) => pos.setXYZ(i, v.x, v.y, v.z));
      pos.needsUpdate = true;
      geo.setDrawRange(0, Math.min(max, segs.length) * 2);
    };
  }
  const drawChains = segments(COLOR.limb, 16);
  const drawGaze = segments(0x888888, 4);

  const gaze = new Map(); // fig → 視線ハンドルの距離。最後に置いた所に留める
  const home = ({ fig, kind }) => {
    if (kind === 'hips') return wpos(fig.root);
    if (TORSO[kind]) return fig.j.chest.localToWorld(V(...TORSO[kind]));
    if (POLE[kind]) return wpos(fig.j[kind]);
    if (kind === 'head') return fig.j.head.localToWorld(V(0, 0, gaze.get(fig) ?? GAZE).add(V(...EYE)));
    if (TIP[kind]) return tipOf(fig, TIP[kind]);
    return wpos(fig.j[CHAIN[kind][2]]);
  };
  // 手先（中指の先あたり）・足先（つま先）
  const tipOf = (fig, joint) => {
    if (joint.endsWith('Wrist')) return fig.j[joint].localToWorld(V(0, -0.17 * fig.b.hand, 0));
    const a = wpos(fig.j[joint]), t = wpos(fig.j[joint.replace('Ankle', 'Toe')]);
    return t.add(t.clone().sub(a).multiplyScalar(0.35));
  };
  // reach の目標に合わせる末端。手は手のひらの中心、足は足首
  const endOf = (fig, limb) => (limb.endsWith('Hand') ? fig.part(limb) : wpos(fig.j[CHAIN[limb][2]]));
  // 手足のハンドルは手首・足首を目標に解く
  const handleGoal = (fig, limb, at) => ({ ...limbGoal(fig, limb, at), wrist: true });

  // 手首・足首を回して、手先・足先を target の方へ向ける（開始時の向きからの最小の回転。可動域で丸める）
  function aimTip(fig, target, { joint, q0, from }) {
    const J = fig.j[joint], o = wpos(J);
    const to = target.clone().sub(o);
    if (to.lengthSq() < 1e-10) return;
    const q = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.normalize()).multiply(q0);
    J.quaternion.copy(J.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
    fig.setJoint(joint, fig.getJoint(joint));
    fig.root.updateMatrixWorld(true);
  }

  // ---- 解く
  // 肘・膝の今の曲がる向きを pole（hips 座標系）として取り出す。伸びきっていれば reach の既定に任せる
  function poleOf(fig, limb, min = 0.01) {
    const [a, b, c] = CHAIN[limb].map((n) => wpos(fig.j[n]));
    const dir = c.sub(a).normalize();
    const v = b.sub(a);
    v.addScaledVector(dir, -v.dot(dir));
    if (v.length() < min) return undefined;
    return v.applyQuaternion(fig.root.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize().toArray();
  }

  // 胸・首・頭に配分して target へ顔を向ける。chest0 は胸の元の角度
  function aim(fig, target, chest0) {
    let yaw = 0, pitch = 0;
    const set = () => {
      fig.setJoint('chest', [chest0[0] + pitch * AIM_W.chest, chest0[1], chest0[2] + yaw * AIM_W.chest]);
      fig.setJoint('neck', [pitch * AIM_W.neck, 0, yaw * AIM_W.neck]);
      fig.setJoint('head', [pitch * AIM_W.head, 0, yaw * AIM_W.head]);
      fig.root.updateMatrixWorld(true);
    };
    for (let i = 0; i < 5; i++) {
      set();
      const l = fig.j.head.worldToLocal(target.clone()).sub(V(...EYE));
      yaw = clamp(yaw + Math.atan2(l.x, l.z) / D2R, -200, 200);
      pitch = clamp(pitch - Math.atan2(l.y, Math.hypot(l.x, l.z)) / D2R, -150, 250);
    }
    set();
  }

  // 胴のハンドル（背中・胸）: 腰を止めたまま、背と胸の前屈・横への傾きを足して、ハンドルの点を target へ寄せる（ひねりは保つ）。
  // 前・下へ引くと背が丸まり、後ろ・上へ引くと反る。首で少し戻し、頭はワールドでの向きを保つ（丸めると首が前へ出て、顔は前を向いたまま）
  function bendTorso(fig, target, start) {
    const { spine0, chest0, neck0, head0, at } = start;
    const set = ([p, r]) => {
      fig.setJoint('spine', [spine0[0] + p * BEND.spine, spine0[1] + r * BEND.spine, spine0[2]]);
      fig.setJoint('chest', [chest0[0] + p * BEND.chest, chest0[1] + r * BEND.chest, chest0[2]]);
      fig.root.updateMatrixWorld(true);
      return fig.j.chest.localToWorld(V(...at));
    };
    let x = start.x ?? [0, 0];
    for (let it = 0; it < 8; it++) {
      const p0 = set(x), e = target.clone().sub(p0);
      if (e.lengthSq() < 1e-8) break;
      const J = [0, 1].map((i) => { const y = [...x]; y[i] += 1; return set(y).sub(p0); });
      const a = J[0].dot(J[0]) + 1e-6, b = J[0].dot(J[1]), c = J[1].dot(J[1]) + 1e-6;
      const g0 = J[0].dot(e), g1 = J[1].dot(e), det = a * c - b * b;
      const d = [(c * g0 - b * g1) / det, (a * g1 - b * g0) / det];
      const n = Math.hypot(...d);
      x = x.map((v, i) => clamp(v + d[i] * Math.min(1, 15 / n), -150, 150));
    }
    set(x);
    start.x = x;
    fig.setJoint('neck', [neck0[0] - x[0] * NECK_COUNTER, neck0[1] - x[1] * NECK_COUNTER, neck0[2]]);
    fig.root.updateMatrixWorld(true);
    const q = fig.j.neck.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(head0);
    fig.j.head.quaternion.copy(q);
    fig.setJoint('head', fig.getJoint('head'));
    fig.root.updateMatrixWorld(true);
  }

  // Ctrl+視線のハンドル: 頭を前後へ平行に動かす（首の付け根を前へ曲げ、頭を同じだけ起こす。顔の向きは保つ）。
  // 動かした量を胸の前の向きへ映し、首の長さで角度に直す
  function shiftHead(fig, target, start) {
    const { neck0, head0, from } = start;
    const fwd = V(0, 0, 1).transformDirection(fig.j.chest.matrixWorld);
    const L = wpos(fig.j.head).distanceTo(wpos(fig.j.neck)) || 0.08;
    const a = Math.asin(clamp(target.clone().sub(from).dot(fwd) / L, -0.9, 0.9)) / D2R;
    fig.setJoint('neck', [neck0[0] + a, neck0[1], neck0[2]]);
    const got = fig.getJoint('neck')[0] - neck0[0];
    fig.setJoint('head', [head0[0] - got, head0[1], head0[2]]);
    fig.root.updateMatrixWorld(true);
  }

  // ---- ドラッグ
  let drag = null; // {h, cur, last, id, limbs, chest0?}
  let hover = null;
  let visible = true;
  const pinBox = document.createElement('input');
  pinBox.type = 'checkbox';

  // 画面上で一番近いハンドルと距離（px）
  function pick(x, y) {
    if (!visible) return null;
    const r = canvas.getBoundingClientRect();
    let best = null, bd = HIT_PX;
    for (const h of handles) {
      if (!ctx.pickable(h.fig) || !h.mesh.visible) continue;
      const p = h.mesh.position.clone().project(camera);
      if (p.z > 1) continue;
      const d = Math.hypot((p.x + 1) / 2 * r.width + r.left - x, (1 - p.y) / 2 * r.height + r.top - y);
      if (d < bd) { bd = d; best = { h, d }; }
    }
    return best;
  }
  const ray = new THREE.Raycaster();
  function planeHit(x, y, through) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(V()), through);
    return ray.ray.intersectPlane(plane, V());
  }

  // 主軸 p と副軸 s で張る正規直交基底
  const basis = (p, s) => {
    const x = p.clone().normalize();
    const y = s.clone().addScaledVector(x, -s.dot(x));
    if (y.lengthSq() < 1e-10) return null;
    y.normalize();
    return new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y));
  };

  // 手足の IK の拘束。肘・膝の曲がる向きと、手首のひねり、足首の向き（ワールド）を drag の開始時に控える
  function limbGoal(fig, limb, at) {
    const [, nb, nc] = CHAIN[limb];
    const g = { limb, at, pole: poleOf(fig, limb), twist: fig.getJoint(nb)[2] };
    if (limb.endsWith('Foot')) g.foot = fig.j[nc].getWorldQuaternion(new THREE.Quaternion());
    return g;
  }

  // 肩・股の 3 軸と肘・膝の曲げ x = [a, b, c, bend]（度）を関節に入れ、末端の位置を返す。
  // setJoint が可動域で丸めるので、実際に入った値は read() で読み直す
  // wrist: 手の末端を手首にする（既定は手のひらの中心）
  function kinematics(fig, limb, twist, wrist = false) {
    const [A, B, C] = CHAIN[limb].map((n) => fig.j[n]);
    const off = limb.endsWith('Hand') && !wrist ? C.worldToLocal(fig.part(limb)) : V();
    // 肩の上の鎖骨・肩の土台は腕の向きで動く（肩甲上腕リズム）ので、腰から末端までの全部を毎回組み直す
    const path = [];
    for (let o = C; o && o !== fig.root; o = o.parent) path.unshift(o);
    const fk = (x) => {
      fig.setJoint(A.name, x.slice(0, 3));
      fig.setJoint(B.name, [x[3], 0, twist]);
      for (const o of path) {
        o.updateMatrix();
        o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
      }
      return off.clone().applyMatrix4(C.matrixWorld);
    };
    const read = () => [...fig.getJoint(A.name), fig.getJoint(B.name)[0]];
    return { fk, read, lim: limits(fig, A.name) };
  }

  // 関節の可動域 [[lo, hi] x3]。setJoint の丸めを試して読み取る
  const limitCache = {};
  function limits(fig, name) {
    if (limitCache[name]) return limitCache[name];
    const g = fig.j[name], keep = g.rotation.clone();
    // 下限は軸ごとに読む（肩の後ろの限界は横への上げで広がるので、他の軸を下限に振ると狭い方を読む）
    const lo = [0, 1, 2].map((i) => { fig.setJoint(name, [0, 1, 2].map((k) => (k === i ? -1e4 : 1e4))); return fig.getJoint(name)[i]; });
    fig.setJoint(name, [1e4, 1e4, 1e4]);
    const hi = fig.getJoint(name);
    g.rotation.copy(keep);
    return (limitCache[name] = lo.map((l, i) => [l, hi[i]]));
  }

  // 可動域の中での減衰最小二乗法（Levenberg-Marquardt）。x から始めて末端を at へ寄せる。
  // 肩・股が可動域の端から MARGIN 度以内に入るのを弱く嫌い、余った自由度（肘・膝の向き）で端を避ける
  const CONTINUE = 0.02; // 肘・膝の向きを替えてよい届かなさ（m）
  const NEAR = 0.005; // 届いたと見なす（m）
  const STAY = 3e-4; // 関節を 1 度動かすことを何 m のずれと同じに見るか（10 度で 3mm）
  const MARGIN = 20, MARGIN_K = 0.15, SOFT = 2e-4; // SOFT: 端へ 1 度入ることを何 m のずれと同じに見るか
  function descend({ fk, read, lim }, x, at) {
    // 端を嫌う幅は 0 から端までの角度の MARGIN_K 倍（最大 MARGIN）。後ろへの振りのように狭い側で可動域を使い切れるように
    const mg = lim.map(([lo, hi]) => [Math.min(MARGIN, MARGIN_K * Math.abs(lo)), Math.min(MARGIN, MARGIN_K * Math.abs(hi))]);
    const pen = (x) => lim.map(([lo, hi], i) => Math.max(0, mg[i][0] - (x[i] - lo)) - Math.max(0, mg[i][1] - (hi - x[i])));
    let p = fk(x);
    x = read();
    // 寄せ始めの姿勢から離れるほど損にする（肘・膝の向きなど、目標に関係ない向きを勝手に変えない）
    const x0 = [...x];
    const costOf = (p, x) => p.distanceToSquared(at) + SOFT ** 2 * pen(x).reduce((s, v) => s + v * v, 0)
      + STAY ** 2 * x.reduce((s, v, i) => s + (v - x0[i]) ** 2, 0);
    let cost = costOf(p, x), lam = 1e-5;
    for (let it = 0; it < 40 && cost > 1e-8; it++) {
      const J = x.map((_, i) => {
        for (const h of [0.5, -0.5]) {
          const y = [...x];
          y[i] += h;
          const q = fk(y);
          const dh = read()[i] - x[i];
          if (Math.abs(dh) > 1e-6) return q.sub(p).divideScalar(dh);
        }
        return V();
      });
      const e = p.clone().sub(at);
      const b = pen(x);
      // 残差 [p - at, SOFT * b] の正規方程式。free でない軸は動かさない
      const step = (free) => {
        const g = x.map((_, i) => (free[i] ? J[i].dot(e) - (i < 3 ? SOFT ** 2 * b[i] : 0) + STAY ** 2 * (x[i] - x0[i]) : 0));
        const m = x.map((_, r) => x.map((_, c) => {
          if (!free[r] || !free[c]) return r === c ? 1 : 0;
          return J[r].dot(J[c]) + (r === c ? lam + STAY ** 2 + (r < 3 && b[r] ? SOFT ** 2 : 0) : 0);
        }));
        const M = new THREE.Matrix4().set(...m.flat()).invert();
        const dx = new THREE.Vector4(...g).applyMatrix4(M).toArray().map((v) => -v);
        const n = Math.hypot(...dx);
        return n > 20 ? dx.map((d) => d * 20 / n) : dx;
      };
      let dx = step(x.map(() => true));
      // 可動域の端で外へ押す軸は止めて解き直す
      fk(x.map((v, i) => v + dx[i]));
      const stuck = read().map((v, i) => Math.abs(v - (x[i] + dx[i])) > 1e-6);
      if (stuck.some(Boolean)) dx = step(stuck.map((s) => !s));
      const q = fk(x.map((v, i) => v + dx[i]));
      const y = read();
      const c = costOf(q, y);
      if (c < cost) {
        x = y;
        p = q;
        cost = c;
        lam = Math.max(1e-9, lam / 3);
      } else {
        lam *= 5;
        if (lam > 1) break;
      }
    }
    fk(x);
    return { x, err: p.distanceTo(at), cost };
  }

  // reach の形を、関節の自由度（肩・股の 3 軸、肘・膝の曲げ）で表せる回転に直したもの
  function fromReach(fig, limb, at, pole, twist) {
    const [A, B, C] = CHAIN[limb].map((n) => fig.j[n]);
    reach(fig, limb, at, pole);
    const S = wpos(A), E = wpos(B).sub(S), W = wpos(C).sub(S);
    fig.setJoint(B.name, [E.angleTo(W.clone().sub(E)) / D2R, 0, twist]);
    const inv = A.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const src = basis(B.position.clone().add(C.position.clone().applyQuaternion(B.quaternion)), B.position);
    const dst = basis(W.applyQuaternion(inv), E.applyQuaternion(inv));
    if (src && dst) A.quaternion.setFromRotationMatrix(dst.multiply(src.transpose()));
    return [...inLimits(fig, A), fig.getJoint(B.name)[0]];
  }

  // 関節の今の回転の semantic。同じ回転の Euler は 2 通りある。three.js は中央の軸を ±90° に収める方を返すので、もう一方と比べて可動域に近い方を使う
  function inLimits(fig, A) {
    const e = A.rotation.clone();
    const wrap = (v) => Math.atan2(Math.sin(v), Math.cos(v));
    const sems = [[e.x, e.y, e.z], [wrap(e.x + Math.PI), wrap(e.y + Math.PI), wrap(Math.PI - e.z)]].map(([x, y, z]) => {
      A.rotation.set(x, y, z);
      return fig.getJoint(A.name);
    });
    const over = (v) => limits(fig, A.name).reduce((sum, [lo, hi], i) => sum + Math.max(0, lo - v[i], v[i] - hi), 0);
    return over(sems[1]) < over(sems[0]) ? sems[1] : sems[0];
  }

  // 伸びきった手足を曲げ始めるときに試す肘・膝の向き（hips 座標系）。reach の既定に加える
  const FRESH = { Hand: [[0, -1, 1], [1, -1, 0]], Foot: [] };
  const AROUND = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // 肘が肩より 1cm 上にあることを何 m のずれと同じに見るか
  const ELBOW_UP = 0.3;
  const score = (r) => r.err + Math.sqrt(r.cost);
const better = (a, b) => (Math.abs(a.err - b.err) > 0.005 ? a.err < b.err : a.cost < b.cost);

  // 今の姿勢から寄せるのを基本にする（動きが連続する）。届かないときは肘・膝の向きを変えた reach の解からも寄せ、
  // 伸びきっていて向きが決まらないときは候補から可動域の端を避ける方を取る
  function solveLimb(fig, g) {
    const { limb, at, twist, foot } = g;
    const C = fig.j[CHAIN[limb][2]];
    fig.root.updateMatrixWorld(true);
    const kin = kinematics(fig, limb, twist, g.wrist);
    const cur = kin.read();
    // 今の肘・膝の向きを保つのが第一。今の姿勢から寄せて 2cm 以上届かないときだけ別の向きを試し、2cm 以上近づくものに替える
    // 候補どうしは届き具合が同じなら、今の姿勢に近く、肘が上を向かない方を取る（向きを替えた解は今の姿勢を知らない）
    const A = fig.j[CHAIN[limb][0]], B = fig.j[CHAIN[limb][1]];
    const settle = (r) => {
      const up = limb.endsWith('Hand') ? Math.max(0, wpos(B).sub(wpos(A)).applyQuaternion(fig.root.getWorldQuaternion(new THREE.Quaternion()).invert()).y) : 0;
      r.cost += STAY ** 2 * r.x.reduce((sum, v, i) => sum + (v - cur[i]) ** 2, 0) + (ELBOW_UP * up) ** 2;
      return r;
    };
    let best = settle(descend(kin, cur, at));
    const far = best.err > CONTINUE;
    if (far || !g.pole) {
      const s = limb.startsWith('left') ? 1 : -1;
      const fresh = FRESH[limb.slice(-4)].map(([x, y, z]) => [x * s, y, z]);
      const poles = far ? [g.pole, undefined, ...fresh, ...AROUND] : [undefined, ...fresh];
      const base = best;
      for (const pole of poles) {
        const r = settle(descend(kin, fromReach(fig, limb, at, pole, twist), at));
        // 届かないときは 2cm 以上近づくか、ほぼ届く（5mm 以内）候補だけ。2cm ぎりぎり届かない所では、
        // 「2cm 以上近づく」を満たすのが向きの飛んだ候補（肩 [168,169,-74]）だけになり、近い候補より先に選ばれていた
        // 届いているとき（腕が伸びきって向きが決まらないので毎回試す）は、届き具合と今の姿勢からの動きを足した量で比べる。
        // better の 5mm の差で選ぶと、手を後ろへ引いた腕が 5mm 近づくだけの向きの飛んだ候補（肩 [-60,24] → [134,145]）に替わった
        if (far ? (r.err < base.err - CONTINUE || r.err < NEAR) && better(r, best) : score(r) < score(best)) best = r;
      }
    }
    kin.fk(best.x);
    fig.root.updateMatrixWorld(true);
    g.pole ??= poleOf(fig, limb, 0.05);
    if (foot) {
      const q = C.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(foot);
      fig.setJoint(C.name, [new THREE.Euler().setFromQuaternion(q, 'XZY').x / D2R]);
    }
    fig.root.updateMatrixWorld(true);
  }

  // ---- 体を貫かない reach: 腕の骨を太さのある線とみなし、相手の体と自分の胴（部品の体）へのめり込みを測る
  const ARM_R = [0.045, 0.035]; // 上腕・前腕の太さ（m）
  const TRUNK = new Set(['hips', 'spine', 'chest', 'neck', 'head']);
  function obstacles(fig) {
    const list = [];
    for (const f of Object.values(figs)) {
      if (!f.root.visible) continue;
      f.root.updateMatrixWorld(true);
      for (const m of f.meshes) {
        if (f === fig && !TRUNK.has(m.userData.joint)) continue;
        const g = m.geometry;
        g.boundingBox ?? g.computeBoundingBox();
        g.boundingSphere ?? g.computeBoundingSphere();
        const sc = new THREE.Vector3().setFromMatrixScale(m.matrixWorld);
        list.push({
          inv: m.matrixWorld.clone().invert(), s: Math.min(sc.x, sc.y, sc.z), box: g.boundingBox,
          sphere: g.type === 'SphereGeometry' ? g.parameters.radius : 0,
          c: g.boundingSphere.center.clone().applyMatrix4(m.matrixWorld), R: g.boundingSphere.radius * Math.max(sc.x, sc.y, sc.z),
        });
      }
    }
    return list;
  }
  const Q = new THREE.Vector3();
  function distTo(o, p) {
    Q.copy(p).applyMatrix4(o.inv);
    if (o.sphere) return (Q.length() - o.sphere) * o.s;
    const { min, max } = o.box;
    const dx = Math.max(min.x - Q.x, 0, Q.x - max.x), dy = Math.max(min.y - Q.y, 0, Q.y - max.y), dz = Math.max(min.z - Q.z, 0, Q.z - max.z);
    const out = Math.hypot(dx, dy, dz);
    return (out > 0 ? out : -Math.min(Q.x - min.x, max.x - Q.x, Q.y - min.y, max.y - Q.y, Q.z - min.z, max.z - Q.z)) * o.s;
  }
  // 上腕と前腕（手首の手前 3 割は除く。手は相手に触れてよい）の、めり込みの深さの二乗和
  function armPenetration(fig, limb, obs) {
    const [a, b, c] = CHAIN[limb].map((n) => wpos(fig.j[n]));
    let sum = 0;
    for (const [p0, p1, r, upto] of [[a, b, ARM_R[0], 1], [b, c, ARM_R[1], 0.7]]) {
      for (let i = 1; i <= 6; i++) {
        const p = p0.clone().lerp(p1, (i / 6) * upto);
        let d = Infinity;
        for (const o of obs) if (p.distanceTo(o.c) < o.R + r) d = Math.min(d, distTo(o, p));
        if (d < r) sum += (r - d) ** 2;
      }
    }
    return sum;
  }
  // 今の解が体を貫くなら、肘の向きと手の置き場所（目標の左右・上下へ少しずらす）を変えて探し直す
  function avoidReach(fig, limb, at, twist, pole0) {
    const obs = obstacles(fig);
    const pen0 = armPenetration(fig, limb, obs);
    if (pen0 < 1e-5) return;
    const kin = kinematics(fig, limb, twist);
    const keep = { x: kin.read(), cost: endOf(fig, limb).distanceToSquared(at) + 4 * pen0 };
    const S = wpos(fig.j[CHAIN[limb][0]]);
    const up = V(0, 1, 0), lat = up.clone().cross(at.clone().sub(S)).normalize();
    const s = limb.startsWith('left') ? 1 : -1;
    const shifts = [[0, 0], [1, 0], [-1, 0], [2, 0], [-2, 0], [0, 1], [0, -1], [1, -1], [-1, -1], [2, -1], [-2, -1]];
    const poles = [pole0, [s, 0, 0], [s, 0, -1], [s, -1, 0], [s, 1, 0], [s, -1, -1], [0, -1, 0], [0, -1, -1]];
    let best = keep;
    for (const [u, v] of shifts) {
      const t = at.clone().addScaledVector(lat, u * 0.06).addScaledVector(up, v * 0.07);
      for (const pole of poles) {
        const r = descend(kin, fromReach(fig, limb, t, pole, twist), t);
        kin.fk(r.x);
        fig.root.updateMatrixWorld(true);
        const cost = endOf(fig, limb).distanceToSquared(at) + 4 * armPenetration(fig, limb, obs);
        if (cost < best.cost) best = { x: r.x, cost };
      }
    }
    kin.fk(best.x);
    fig.root.updateMatrixWorld(true);
  }

  // 操作（apply）の reach も、reach の形から始めて可動域の中で詰め直す
  const reachOp = ctx.apply.handlers.reach;
  ctx.apply.handlers.reach = (op) => {
    const fig = figs[op.who];
    if (!fig || !CHAIN[op.limb]) return reachOp(op);
    const twist = fig.getJoint(CHAIN[op.limb][1])[2];
    reachOp(op);
    // reach の形を可動域に近い方の Euler で持ち直す（可動域の外の Euler から寄せると、肘の向きの違う解へ飛んだ）
    const A = fig.j[CHAIN[op.limb][0]];
    fig.setJoint(A.name, inLimits(fig, A), false);
    fig.root.updateMatrixWorld(true);
    const at = ctx.apply.resolve(op.to, op.offset);
    solveLimb(fig, { limb: op.limb, at, pole: poleOf(fig, op.limb), twist });
    if (op.limb.endsWith('Hand')) avoidReach(fig, op.limb, at, twist, poleOf(fig, op.limb));
    const err = endOf(fig, op.limb).distanceTo(at);
    return err > 0.03 ? `${op.who}.${op.limb} は ${Math.round(err * 100)}cm 届かない` : null;
  };

  // ground の後、立っている人形の浮いた足を床へ下ろす（足首から先の向きは保ち、膝で高さを吸収する）。
  // 一番低い所が足のときだけ。膝立ち・座り・寝た姿勢は触らない
  const PLANT = { reach: 0.3, tilt: 25 };
  const footMin = (fig, limb) => {
    const b = new THREE.Box3();
    for (const m of fig.meshes) if (m.userData.joint === CHAIN[limb][2]) b.expandByObject(m, true);
    return b.min.y;
  };
  function plantFeet(fig) {
    const r = fig.root.rotation;
    if (Math.abs(r.x) > PLANT.tilt * D2R || Math.abs(r.z) > PLANT.tilt * D2R) return [];
    fig.root.updateMatrixWorld(true);
    const feet = ['leftFoot', 'rightFoot'];
    const lows = feet.map((l) => footMin(fig, l));
    const low = Math.min(...lows);
    if (low > fig.box().min.y + 0.02) return [];
    const moved = [];
    feet.forEach((limb, i) => {
      const dy = lows[i] - low;
      if (dy < 0.01 || dy > PLANT.reach) return;
      const g = limbGoal(fig, limb, home({ fig, kind: limb }).sub(V(0, dy, 0)));
      solveLimb(fig, g);
      moved.push(limb);
    });
    return moved;
  }
  const groundOp = ctx.apply.handlers.ground;
  ctx.apply.handlers.ground = (op) => {
    groundOp(op);
    for (const fig of op.who && op.who !== 'both' ? [figs[op.who]] : Object.values(figs)) {
      if (!fig) continue;
      if (plantFeet(fig).length) fig.ground();
    }
    return null;
  };

  // ---- 全身で追従: 手足を引くと、手足だけで届かない分・可動域の端に寄る分を胴が受け持つ。
  // 腕: 肩・肘に加えて鎖骨（すくめる・前へ）、胸、背（曲げ・傾き・ひねり）。腰の位置と向き、足は動かない。
  // 脚: 股・膝に加えて骨盤の前後の傾き。骨盤が後ろへ傾いた分は背と胸で前へ戻すので背中が丸まり、もう片方の足は床に留める。
  // 胴の自由度はドラッグ開始時の値へ戻るばね（STIFF: 1 度動かすことを何 m のずれと同じに見るか）で重く、手足が先に動く。
  // shrug: 鎖骨のすくめ（肘を曲げずに肩をすくめて届かせない）
  const STIFF = { twist: 1e-3, shrug: 2.5e-3, clavicle: 1e-3, chest: 1.2e-3, spine: 1.6e-3, pelvis: 8e-4 };
  // 腕の届かない目標は、肩から腕の長さ + 余り（m）の所へ引き寄せてから解く。腕は目標を向き、胴は余りの分だけ受け持つ。
  // 余りは横・後ろへ back、前・下へは前かがみ・横曲げで届くので lean まで（目標の向きの前の成分と、後ろでない下の成分で混ぜる）
  const REACH_BUDGET = { back: 0.06, lean: 0.3 };
  const EDGE = 2e-3; // 可動域の端の手前 MARGIN 度に入る 1 度を何 m と見るか。胴のばねより重く、端に寄る前に胴が受け持つ
  const PELVIS_BACK = { spine: 0.5, chest: 0.5 }; // 骨盤が後ろへ傾いた角度のうち背・胸で前へ戻す割合（胸は立ったまま腰が丸まる）
  // 膝を伸ばしたまま脚は高く上がらない（ももの裏の張り）: 股の曲げは 75 + 0.5 × 膝 まで楽に、その先は強く嫌う
  const HAM = { base: 75, perKnee: 0.5, w: 2.5e-3 };
  const bodyBox = document.createElement('input');
  bodyBox.type = 'checkbox';
  try { bodyBox.checked = localStorage.getItem('posing-kun.ik.body') !== '0'; } catch { bodyBox.checked = true; }
  bodyBox.addEventListener('change', () => { try { localStorage.setItem('posing-kun.ik.body', bodyBox.checked ? '1' : '0'); } catch { /* 保存できなくても動く */ } });

  // 自由度: { get, set, lim, k, x0 }。set は可動域で丸め、get で読み直す
  const jointVar = (fig, name, i, k = 0) => ({
    get: () => fig.getJoint(name)[i],
    set: (v) => { const a = [null, null, null]; a[i] = v; fig.setJoint(name, a); },
    lim: limits(fig, name)[i], k,
  });

  // 開始時の状態を控える（胴のばねの戻り先、骨盤の向き、頭のワールドの向き、もう片方の足）
  function bodyStart(fig, limb) {
    const arm = limb.endsWith('Hand');
    const side = limb.startsWith('left') ? 'left' : 'right';
    const st = { arm, side, head0: fig.j.head.getWorldQuaternion(new THREE.Quaternion()), q0: fig.root.quaternion.clone(), spine0: fig.getJoint('spine'), chest0: fig.getJoint('chest') };
    if (arm) st.S0 = fig.root.worldToLocal(wpos(fig.j[CHAIN[limb][0]]));
    if (!arm) {
      const other = limb === 'leftFoot' ? 'rightFoot' : 'leftFoot';
      st.pin = limbGoal(fig, other, home({ fig, kind: other }));
      // 骨盤は軸足の股関節のまわりに傾ける（軸足は伸びたまま、足は床に残る）
      st.hipLocal = fig.j[CHAIN[other][0]].position.clone();
      st.pivot = wpos(fig.j[CHAIN[other][0]]);
    }
    return st;
  }

  function bodyVars(fig, limb, st, twist) {
    const [A, B] = CHAIN[limb];
    // 上腕のひねりは届かない分を補う軸にしない（ばねで今の値へ戻す。無いと ±70° に張り付いて肘が上がった）
    const vars = [0, 1, 2].map((i) => jointVar(fig, A, i, st.arm && i === 2 ? STIFF.twist : 0)).concat([{ ...jointVar(fig, B, 0), set: (v) => fig.setJoint(B, [v, 0, twist]) }]);
    if (st.arm) {
      const cl = `${st.side}Clavicle`;
      vars.push(jointVar(fig, cl, 0, STIFF.shrug), jointVar(fig, cl, 1, STIFF.clavicle));
      for (const i of [0, 1, 2]) vars.push(jointVar(fig, 'chest', i, STIFF.chest));
      for (const i of [0, 1, 2]) vars.push(jointVar(fig, 'spine', i, STIFF.spine));
    } else {
      // 骨盤の前後の傾き（度、+ で前へ）。腰の位置は保ち、背と胸で戻す
      const X = V(1, 0, 0);
      vars.push({
        get: () => st.tilt ?? 0,
        set: (v) => {
          st.tilt = Math.max(-35, Math.min(20, v));
          fig.root.quaternion.copy(st.q0).multiply(new THREE.Quaternion().setFromAxisAngle(X, st.tilt * D2R));
          const now = st.hipLocal.clone().multiply(fig.root.scale).applyQuaternion(fig.root.quaternion).add(fig.root.position);
          fig.root.position.add(st.pivot.clone().sub(now));
          const back = Math.max(0, -st.tilt);
          fig.setJoint('spine', [st.spine0[0] + back * PELVIS_BACK.spine]);
          fig.setJoint('chest', [st.chest0[0] + back * PELVIS_BACK.chest]);
        },
        lim: [-35, 20], k: STIFF.pelvis,
      });
    }
    return vars;
  }

  // 小さな連立一次方程式（部分ピボットのガウス消去）
  function solveLinear(M, b) {
    const n = b.length, a = M.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
      [a[c], a[piv]] = [a[piv], a[c]];
      const d = a[c][c] || 1e-12;
      for (let r = c + 1; r < n; r++) {
        const f = a[r][c] / d;
        if (f) for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let v = a[r][n];
      for (let k = r + 1; k < n; k++) v -= a[r][k] * x[k];
      x[r] = v / (a[r][r] || 1e-12);
    }
    return x;
  }

  // 末端を at へ寄せる。残差 = [末端のずれ(3), 胴のばね, 可動域の端の手前, ももの裏] を LM で小さくする
  function solveBody(fig, limb, at, st, twist) {
    const C = fig.j[CHAIN[limb][2]];
    const off = st.arm ? C.worldToLocal(fig.part(limb)) : V();
    if (st.arm) {
      // 肩はドラッグ開始の位置で測る（今の位置で測ると、胴が動いた分だけ毎回先へ引き寄せて胴が際限なく曲がる）
      const [S, E] = CHAIN[limb].map((n) => wpos(fig.j[n]));
      const S0 = fig.root.localToWorld(st.S0.clone());
      const dir = at.clone().sub(S0).normalize();
      const f = dir.dot(V(0, 0, 1).transformDirection(fig.root.matrixWorld)), down = Math.max(0, -dir.dot(V(0, 1, 0).transformDirection(fig.root.matrixWorld)));
      const lean = Math.max(f, down * (1 - Math.max(0, -f)) ** 2);
      const L = E.distanceTo(S) + fig.part(limb).distanceTo(E) + REACH_BUDGET.back + (REACH_BUDGET.lean - REACH_BUDGET.back) * lean;
      if (at.distanceTo(S0) > L) at = S0.addScaledVector(dir, L);
    }
    const vars = bodyVars(fig, limb, st, twist);
    if (st.x0 === undefined) st.x0 = vars.map((v) => v.get());
    const path = [];
    for (let o = C; o && o !== fig.root; o = o.parent) path.unshift(o);
    const fk = () => {
      if (!st.arm) { fig.root.updateMatrix(); fig.root.matrixWorld.multiplyMatrices(fig.root.parent.matrixWorld, fig.root.matrix); }
      for (const o of path) { o.updateMatrix(); o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix); }
      return off.clone().applyMatrix4(C.matrixWorld);
    };
    const setAll = (x) => vars.forEach((v, i) => v.set(x[i]));
    const getAll = () => vars.map((v) => v.get());
    const resid = (p, x) => {
      const r = [p.x - at.x, p.y - at.y, p.z - at.z];
      vars.forEach((v, i) => { if (v.k) r.push(v.k * (x[i] - st.x0[i])); });
      vars.forEach((v, i) => {
        const [lo, hi] = v.lim, m0 = Math.min(MARGIN, MARGIN_K * Math.abs(lo)), m1 = Math.min(MARGIN, MARGIN_K * Math.abs(hi));
        r.push(EDGE * (Math.max(0, m0 - (x[i] - lo)) - Math.max(0, m1 - (hi - x[i]))));
      });
      if (st.arm) r.push(ELBOW_UP * Math.max(0, wpos(fig.j[CHAIN[limb][1]]).sub(wpos(fig.j[CHAIN[limb][0]])).applyQuaternion(fig.root.getWorldQuaternion(new THREE.Quaternion()).invert()).y));
      if (!st.arm) r.push(HAM.w * Math.max(0, x[0] - (HAM.base + HAM.perKnee * x[3])));
      return r;
    };
    const sq = (r) => r.reduce((s, v) => s + v * v, 0);
    let x = getAll();
    let p = fk(), r = resid(p, x), cost = sq(r), lam = 1e-6;
    for (let it = 0; it < 25 && cost > 1e-9; it++) {
      // 数値微分のヤコビアン（可動域の端では反対側へ）
      const J = x.map((_, i) => {
        for (const h of [0.5, -0.5]) {
          const y = [...x];
          y[i] += h;
          vars[i].set(y[i]);
          const got = vars[i].get();
          const q = fk();
          const ri = resid(q, x.map((v, k) => (k === i ? got : v)));
          vars[i].set(x[i]);
          const dh = got - x[i];
          if (Math.abs(dh) > 1e-6) return ri.map((v, k) => (v - r[k]) / dh);
        }
        return r.map(() => 0);
      });
      fk();
      const n = x.length;
      const M = x.map((_, a) => x.map((_, b) => J[a].reduce((s, v, k) => s + v * J[b][k], 0) + (a === b ? lam : 0)));
      const g = x.map((_, a) => -J[a].reduce((s, v, k) => s + v * r[k], 0));
      let dx = solveLinear(M, g);
      const norm = Math.hypot(...dx);
      if (norm > 15) dx = dx.map((d) => d * 15 / norm);
      setAll(x.map((v, i) => v + dx[i]));
      const y = getAll(), q = fk(), ry = resid(q, y), c = sq(ry);
      if (c < cost) { x = y; p = q; r = ry; cost = c; lam = Math.max(1e-9, lam / 3); }
      else { setAll(x); fk(); lam *= 5; if (lam > 1) break; }
      if (n === 0) break;
    }
    setAll(x);
    fig.root.updateMatrixWorld(true);
    // 足首のワールドの向きを保つ（脚）、もう片方の足を床に留める、頭のワールドの向きを保つ
    if (!st.arm) {
      const g = st.goal;
      if (g?.foot) {
        const q = C.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(g.foot);
        fig.setJoint(C.name, [new THREE.Euler().setFromQuaternion(q, 'XZY').x / D2R]);
      }
      fig.root.updateMatrixWorld(true);
      solveLimb(fig, st.pin);
    }
    const q = fig.j.neck.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(st.head0);
    fig.j.head.quaternion.copy(q);
    fig.setJoint('head', fig.getJoint('head'));
    fig.root.updateMatrixWorld(true);
  }

  // 肘・膝: 手足を肩（股）と手首（足首）を結ぶ軸の周りに回し、肘・膝を target の側へ向ける。曲げとひねりはそのまま、
  // 鎖骨の連動で付け根が動いた分は手足の IK で手首・足首を元の位置へ戻す（g は開始時の limbGoal）
  function swivel(fig, limb, target, g) {
    const [na, nb, nc] = CHAIN[limb];
    const [A, B, C] = [na, nb, nc].map((n) => fig.j[n]);
    fig.root.updateMatrixWorld(true);
    // 肘・膝の位置を幾何学的に決める: 付け根と手首（足首、g.at で固定）を結ぶ軸の周りで、target の側の円の上。
    // 今の姿勢から少しずつ寄せると、肩の角度の表し方が退化する所（腕を真横へ上げた所）から抜けられないので、形を直接組み立てる
    const S = wpos(A), la = wpos(B).distanceTo(S), lb = wpos(C).distanceTo(wpos(B));
    const dir = g.at.clone().sub(S), d = clamp(dir.length(), Math.abs(la - lb) + 1e-3, la + lb - 1e-3);
    dir.normalize();
    const perp = target.clone().sub(S);
    perp.addScaledVector(dir, -perp.dot(dir));
    if (perp.lengthSq() < 1e-8) return;
    perp.normalize();
    const cosA = (la * la + d * d - lb * lb) / (2 * la * d);
    const E = dir.clone().multiplyScalar(la * cosA).addScaledVector(perp, la * Math.sqrt(Math.max(0, 1 - cosA * cosA)));
    const W = dir.clone().multiplyScalar(d);
    fig.setJoint(nb, [E.angleTo(W.clone().sub(E)) / D2R, 0, g.twist]);
    const inv = A.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const src = basis(B.position.clone().add(C.position.clone().applyQuaternion(B.quaternion)), B.position);
    const dst = basis(W.applyQuaternion(inv), E.applyQuaternion(inv));
    if (src && dst) A.quaternion.setFromRotationMatrix(dst.multiply(src.transpose()));
    fig.setJoint(na, inLimits(fig, A));
    fig.root.updateMatrixWorld(true);
    // 鎖骨の連動で付け根が動いた分を、肘の向きを保ったまま寄せ直す
    g.pole = poleOf(fig, limb);
    const kin = kinematics(fig, limb, g.twist, g.wrist);
    kin.fk(descend(kin, kin.read(), g.at).x);
    fig.root.updateMatrixWorld(true);
  }

  function solve({ h: { fig, kind }, cur, chest0, limbs, torso, shift, body, tip }) {
    if (tip) return aimTip(fig, cur, tip);
    if (POLE[kind]) return swivel(fig, POLE[kind], cur, limbs[0]);
    if (shift) return shiftHead(fig, cur, shift);
    if (kind === 'head') return aim(fig, cur, chest0);
    if (TORSO[kind]) return bendTorso(fig, cur, torso);
    if (kind === 'hips') {
      fig.root.position.copy(cur);
      fig.root.updateMatrixWorld(true);
    }
    for (const g of limbs) solveLimb(fig, g);
    if (body) solveBody(fig, kind, cur, body, limbs[0].twist);
  }

  // ドラッグと同じ順で解く（確認用）: ハンドル kind を world 座標の点の列 path に沿って動かす
  ctx.ik = {
    overlay: group,
    dragTo(fig, kind, path) {
      const d = { h: { fig, kind }, cur: home({ fig, kind }) };
      d.limbs = [handleGoal(fig, kind, d.cur)];
      if (bodyBox.checked) { d.body = bodyStart(fig, kind); d.body.goal = d.limbs[0]; }
      for (const p of path) { d.cur = p.clone(); solve(d); }
    },
    // 肘・膝のハンドル kind（leftElbow など）を world 座標の点の列 path に沿って動かす
    swivelTo(fig, kind, path) {
      const d = { h: { fig, kind }, cur: home({ fig, kind }), limbs: [{ ...limbGoal(fig, POLE[kind], wpos(fig.j[CHAIN[POLE[kind]][2]])), wrist: true }] };
      for (const p of path) { d.cur = p.clone(); solve(d); }
    },
  };

  // capture 段階で受け、ハンドルに当たったら OrbitControls・ギズモ・クリック選択へ渡さない
  const stage = canvas.parentElement;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas || e.button !== 0) return;
    const hit = pick(e.clientX, e.clientY);
    // ギズモに重なっていれば、ハンドルの球そのものを押したときだけハンドルを取る
    if (!hit || (ctx.tc.axis && hit.d > PX)) return;
    const { h } = hit;
    e.stopPropagation();
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    orbit.enabled = false;
    const { fig, kind } = h;
    ctx.focus?.(fig);
    drag = { h, cur: h.mesh.position.clone(), start: [e.clientX, e.clientY], last: [e.clientX, e.clientY], id: e.pointerId, moved: false };
    if (kind === 'head') drag.chest0 = fig.getJoint('chest');
    if (TORSO[kind]) drag.torso = { at: TORSO[kind], spine0: fig.getJoint('spine'), chest0: fig.getJoint('chest'), neck0: fig.getJoint('neck'), head0: fig.j.head.getWorldQuaternion(new THREE.Quaternion()) };
    if (kind === 'head' && (e.ctrlKey || e.metaKey)) drag.shift = { neck0: fig.getJoint('neck'), head0: fig.getJoint('head'), from: drag.cur.clone() };
    const pin = kind === 'hips' && (e.altKey || pinBox.checked);
    if (TIP[kind]) drag.tip = { joint: TIP[kind], q0: fig.j[TIP[kind]].getWorldQuaternion(new THREE.Quaternion()), from: drag.cur.clone().sub(wpos(fig.j[TIP[kind]])) };
    drag.limbs = CHAIN[kind] ? [handleGoal(fig, kind, drag.cur)]
      : POLE[kind] ? [{ ...limbGoal(fig, POLE[kind], wpos(fig.j[CHAIN[POLE[kind]][2]])), wrist: true }]
      : pin ? ['leftFoot', 'rightFoot'].map((l) => limbGoal(fig, l, home({ fig, kind: l }))) : [];
    if (CHAIN[kind] && bodyBox.checked) {
      drag.body = bodyStart(fig, kind);
      drag.body.goal = drag.limbs[0];
    }
    canvas.style.cursor = 'grabbing';
  }, true);

  stage.addEventListener('pointermove', (e) => {
    if (!drag) {
      if (e.target !== canvas) return;
      hover = pick(e.clientX, e.clientY)?.h ?? null;
      canvas.style.cursor = hover ? 'grab' : '';
      return;
    }
    if (e.pointerId !== drag.id) return;
    e.stopPropagation();
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.start[0], e.clientY - drag.start[1]) <= 3) return;
      drag.moved = true;
      ctx.pushUndo();
    }
    const [lx, ly] = drag.last;
    if (e.shiftKey) {
      const r = canvas.getBoundingClientRect();
      const ppw = 2 * drag.cur.distanceTo(camera.position) * Math.tan(camera.fov * D2R / 2) / r.height;
      drag.cur.addScaledVector(camera.getWorldDirection(V()), (ly - e.clientY) * ppw);
    } else {
      const a = planeHit(lx, ly, drag.cur), b = planeHit(e.clientX, e.clientY, drag.cur);
      if (a && b) drag.cur.add(b.sub(a));
    }
    drag.last = [e.clientX, e.clientY];
    const t0 = performance.now();
    solve(drag);
    ctx.ikMs = performance.now() - t0; // 1 回の解く時間（計測用）
    ctx.refreshSel();
  }, true);

  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.stopPropagation();
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    const { h: { fig, kind }, moved, cur, shift } = drag;
    drag = null;
    orbit.enabled = true;
    canvas.style.cursor = '';
    if (moved) {
      if (kind === 'head' && !shift) gaze.set(fig, Math.max(0.15, fig.j.head.worldToLocal(cur.clone()).distanceTo(V(...EYE))));
      ctx.persist();
      ctx.refreshSel();
      return;
    }
    // 動かさずに離したら、手足のハンドル・アンカーは手首・足首を、ほかはハンドルの下の部位（無ければハンドルの関節）を選ぶ
    if (CHAIN[kind] || TIP[kind]) return ctx.select(fig, CHAIN[kind]?.[2] ?? TIP[kind]);
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(Object.values(figs).filter((f) => ctx.pickable(f)).flatMap((f) => f.meshes), false)[0];
    if (hit) ctx.select(hit.object.userData.fig, hit.object.userData.joint);
    else ctx.select(fig, CHAIN[kind]?.[2] ?? TIP[kind] ?? (TORSO[kind] ? 'chest' : kind));
  };
  // ドラッグ中の元に戻すは、その途中の姿勢を壊すので受けない
  addEventListener('keydown', (e) => {
    if (drag && e.key === 'z' && (e.ctrlKey || e.metaKey)) e.stopImmediatePropagation();
  }, true);
  stage.addEventListener('pointerup', end, true);
  stage.addEventListener('pointercancel', end, true);

  // ---- 毎フレーム: ハンドルの位置と IK の線
  ctx.onFrame(() => {
    group.visible = visible;
    if (!visible) return;
    const k = 2 * Math.tan(camera.fov * D2R / 2) / Math.max(1, canvas.clientHeight) * PX;
    for (const h of handles) {
      const p = drag?.h === h ? drag.cur : home(h);
      h.mesh.position.copy(p);
      const sel = ctx.getSelected();
      h.mesh.visible = ctx.pickable(h.fig) && (!TIP[h.kind] || (sel?.fig === h.fig && sel.joint === TIP[h.kind]));
      h.mesh.scale.setScalar(camera.position.distanceTo(p) * k * (TIP[h.kind] ? TIP_SCALE : 1) * (hover === h || drag?.h === h ? 1.4 : 1));
    }
    const active = new Set();
    const sel = ctx.getSelected();
    const sl = sel && limbOfJoint(sel.joint);
    if (sl) active.add(`${sel.fig.who}.${sl}`);
    for (const { limb } of drag?.limbs ?? []) active.add(`${drag.h.fig.who}.${limb}`);
    drawChains([...active].flatMap((key) => {
      const [who, limb] = key.split('.');
      const [a, b, c] = CHAIN[limb].map((j) => wpos(figs[who].j[j]));
      return [[a, b], [b, c]];
    }));
    drawGaze(handles.filter((h) => h.kind === 'head' && ctx.pickable(h.fig)).map((h) => [h.fig.j.head.localToWorld(V(...EYE)), h.mesh.position]));
  });

  // ---- UI
  const KEY = 'posing-kun.ikdrag.visible';
  try { visible = localStorage.getItem(KEY) !== '0'; } catch { /* 既定は表示 */ }
  const btn = document.createElement('button');
  const label = () => { btn.textContent = `IKハンドル: ${visible ? '表示' : '非表示'}`; };
  btn.addEventListener('click', () => {
    visible = !visible;
    hover = null;
    label();
    try { localStorage.setItem(KEY, visible ? '1' : '0'); } catch { /* 保存できなくても動く */ }
  });
  label();
  ctx.bar.append(btn);

  const fs = document.createElement('fieldset');
  fs.innerHTML = '<legend>IKハンドル</legend><label>手足を引くと胴も動く</label><label>腰を動かすとき足を固定</label>'
    + '<div style="color:#666;font-size:12px">青: 手首・足首（クリックで選ぶと手先・足先に水色の小さなアンカーが出て、引くと手首・足首を止めたまま手・足の向きを変える）、橙: 腰、紫: 背中・桃: 胸（腰を止めて丸める・反らす・傾ける、顔の向きは保つ）、緑: 視線（Ctrl+ドラッグで頭を前後へ出す）<br>ドラッグは画面に平行に動く。手を体の後ろ・前へ回すときは上か横から見るか、Shift+ドラッグ（上下で奥行き）。Alt+腰で足を固定</div>';
  const labels = fs.querySelectorAll('label');
  labels[0].append(bodyBox);
  labels[1].append(pinBox);
  ctx.panel.append(fs);

  // PNG 保存の画像にハンドルを写さない
  document.getElementById('png')?.addEventListener('click', () => {
    group.visible = false;
    setTimeout(() => { group.visible = visible; });
  }, true);
}

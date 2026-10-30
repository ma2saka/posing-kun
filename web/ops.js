// 操作列を人形に適用する（UI・確認用の道具から使う）。
import * as THREE from 'three';
import { JOINTS } from './figure.js';

const D2R = Math.PI / 180;

// rot は [ピッチ(前へ倒す), ヨー(左へ向く), ロール]。ground: 床に下ろすか
// 立ったときの腕: 少し後ろ・外へ開き、手が太もも・腰に当たらない（姿勢で肩を指定すればそちらが勝つ）
const STAND_ARMS = { leftShoulder: [-40, 24, 0], rightShoulder: [-40, 24, 0], leftWrist: [-35], rightWrist: [-35] };

export const PRESETS = {
  stand: { rot: [0, null, 0], joints: {}, ground: true },
  sit: { rot: [0, null, 0], joints: { leftHip: [90, 5], rightHip: [90, 5], leftKnee: [90], rightKnee: [90] }, ground: false },
  sit_floor: { rot: [0, null, 0], joints: { leftHip: [85, 5], rightHip: [85, 5], spine: [10], leftShoulder: [0, 15], rightShoulder: [0, 15] }, ground: true },
  cross_legged: { rot: [0, null, 0], joints: { leftHip: [75, 45, 45], rightHip: [75, 45, 45], leftKnee: [135], rightKnee: [135], spine: [10] }, ground: true },
  seiza: { rot: [0, null, 0], joints: { leftHip: [95], rightHip: [95], leftKnee: [160], rightKnee: [160], leftAnkle: [50], rightAnkle: [50] }, ground: true },
  kneel: { rot: [0, null, 0], joints: { leftKnee: [90], rightKnee: [90], leftAnkle: [40], rightAnkle: [40] }, ground: true },
  squat: { rot: [0, null, 0], joints: { leftHip: [125, 15], rightHip: [125, 15], leftKnee: [150], rightKnee: [150], leftAnkle: [-25], rightAnkle: [-25], spine: [25], leftShoulder: [40], rightShoulder: [40] }, ground: true },
  all_fours: { rot: [90, null, 0], joints: { leftHip: [90], rightHip: [90], leftKnee: [90], rightKnee: [90], leftShoulder: [90], rightShoulder: [90], neck: [-30], head: [-30], leftAnkle: [40], rightAnkle: [40] }, ground: true },
  lie_back: { rot: [-90, null, 0], joints: {}, ground: true },
  lie_front: { rot: [90, null, 0], joints: { head: [-20, 0, 40] }, ground: true },
  lie_side: { rot: [0, null, 90], joints: { leftHip: [30], rightHip: [20], leftKnee: [40], rightKnee: [30] }, ground: true },
};

const ARM = { leftHand: ['leftShoulder', 'leftElbow', 'leftWrist'], rightHand: ['rightShoulder', 'rightElbow', 'rightWrist'] };
const LEG = { leftFoot: ['leftHip', 'leftKnee', 'leftAnkle'], rightFoot: ['rightHip', 'rightKnee', 'rightAnkle'] };
const POLE = { arm: (s) => [s * 0.4, -0.6, -1], leg: () => [0, 0.2, 1] };

const wpos = (o) => o.getWorldPosition(new THREE.Vector3());
const wquat = (o) => o.getWorldQuaternion(new THREE.Quaternion());

function aimBone(joint, child, target) {
  const from = wpos(child).sub(wpos(joint)).normalize();
  const to = target.clone().sub(wpos(joint)).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(from, to).multiply(wquat(joint));
  joint.quaternion.copy(wquat(joint.parent).invert().multiply(q));
  joint.updateMatrixWorld(true);
}

// 2 本の骨の IK。pole は体（hips）座標系での肘・膝の向き
export function reach(fig, limb, target, pole) {
  const chain = ARM[limb] ?? LEG[limb];
  if (!chain) throw new Error(`reach できるのは leftHand/rightHand/leftFoot/rightFoot: ${limb}`);
  const [a, b, c] = chain.map((n) => fig.j[n]);
  fig.root.updateMatrixWorld(true);
  const S = wpos(a);
  const la = wpos(b).distanceTo(S);
  const lb = wpos(c).distanceTo(wpos(b));
  let T = target.clone();
  if (ARM[limb]) {
    const hand = 0.07 * fig.b.hand * fig.b.scale;
    T.sub(T.clone().sub(S).normalize().multiplyScalar(hand));
  }
  const dir = T.clone().sub(S);
  const d = THREE.MathUtils.clamp(dir.length(), Math.abs(la - lb) + 1e-3, la + lb - 1e-3);
  dir.normalize();
  const sgn = limb.startsWith('left') ? 1 : -1;
  const pv = new THREE.Vector3(...(pole ?? (ARM[limb] ? POLE.arm(sgn) : POLE.leg()))).applyQuaternion(wquat(fig.root));
  const perp = pv.sub(dir.clone().multiplyScalar(pv.dot(dir)));
  if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1);
  perp.normalize();
  const cosA = (la * la + d * d - lb * lb) / (2 * la * d);
  const elbow = S.clone().addScaledVector(dir, la * cosA).addScaledVector(perp, la * Math.sqrt(Math.max(0, 1 - cosA * cosA)));
  const end = S.clone().addScaledVector(dir, d);
  aimBone(a, b, elbow);
  aimBone(b, c, end);
  return T.distanceTo(wpos(c));
}

// 頭と首をターゲットへ向ける
function look(fig, target) {
  for (const n of ['neck', 'head']) fig.setJoint(n, [0, 0, 0]);
  fig.root.updateMatrixWorld(true);
  const h = fig.j.head;
  const local = h.worldToLocal(target.clone()).sub(new THREE.Vector3(0, 0.1, 0));
  const yaw = Math.atan2(local.x, local.z) / D2R;
  const pitch = -Math.atan2(local.y, Math.hypot(local.x, local.z)) / D2R;
  fig.setJoint('neck', [pitch * 0.4, 0, yaw * 0.4]);
  fig.setJoint('head', [pitch * 0.6, 0, yaw * 0.6]);
}

export function createOps(figs) {
  const fig = (who) => {
    const f = figs[who];
    if (!f) throw new Error(`who は female か male: ${who}`);
    return f;
  };
  const whos = (who) => (who === 'both' ? Object.keys(figs) : [who]);
  // to: {who, part} またはワールド座標 [x,y,z]。offset は相手の体の向きでの [左, 上, 前]
  const resolve = (to, offset) => {
    if (Array.isArray(to)) return new THREE.Vector3(...to);
    const f = fig(to.who);
    const p = f.part(to.part);
    if (offset) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, f.root.rotation.y, 0));
      p.add(new THREE.Vector3(...offset).applyQuaternion(q));
    }
    return p;
  };

  const handlers = {
    reset({ who = 'both' }) {
      for (const w of whos(who)) {
        const f = fig(w);
        f.setState({ rot: [0, f.root.rotation.y / D2R, 0], joints: { ...STAND_ARMS } });
        f.ground();
      }
    },
    preset({ who, name }) {
      const p = PRESETS[name];
      if (!p) throw new Error(`unknown preset: ${name}`);
      for (const w of whos(who)) {
        const f = fig(w);
        const yaw = p.rot[1] ?? f.root.rotation.y / D2R;
        f.setState({ rot: [p.rot[0], yaw, p.rot[2]], joints: { ...STAND_ARMS, ...p.joints } });
        if (p.ground) f.ground();
      }
    },
    pose({ who, joints }) {
      const f = fig(who);
      const cut = [];
      for (const [n, v] of Object.entries(joints)) {
        if (!(n in JOINTS)) throw new Error(`unknown joint: ${n}`);
        const want = Array.isArray(v) ? v : [v];
        f.setJoint(n, want);
        const got = f.getJoint(n);
        if (want.some((x, i) => x != null && Math.abs(x - got[i]) > 0.5)) cut.push(`${n} ${JSON.stringify(want)}→${JSON.stringify(got.map(Math.round))}`);
      }
      return cut.length ? `可動域で切り詰め ${cut.join(', ')}` : null;
    },
    place({ who, pos, rot }) {
      const f = fig(who);
      const r = f.root;
      if (pos) r.position.set(pos[0] ?? r.position.x, pos[1] ?? r.position.y, pos[2] ?? r.position.z);
      if (rot) r.rotation.set(...[0, 1, 2].map((i) => (rot[i] ?? [r.rotation.x, r.rotation.y, r.rotation.z][i] / D2R) * D2R));
      r.updateMatrixWorld(true);
    },
    turn({ who, yaw = 0, pitch = 0, roll = 0 }) {
      const r = fig(who).root;
      r.rotation.set(r.rotation.x + pitch * D2R, r.rotation.y + yaw * D2R, r.rotation.z + roll * D2R);
    },
    face({ who, to }) {
      const f = fig(who);
      const t = resolve(to);
      const p = f.root.position;
      f.root.rotation.y = Math.atan2(t.x - p.x, t.z - p.z);
    },
    align({ who, part, to, offset, keepHeight = false }) {
      const f = fig(who);
      const d = resolve(to, offset).sub(f.part(part));
      if (keepHeight) d.y = 0;
      f.root.position.add(d);
      f.root.updateMatrixWorld(true);
    },
    reach({ who, limb, to, offset, pole, elbow }) {
      const sgn = limb.startsWith('left') ? 1 : -1;
      const named = { out: [sgn, 0, 0], down: [0, -1, 0], back: [0, 0, -1], forward: [0, 0, 1], up: [0, 1, 0], in: [-sgn, 0, 0] };
      const err = reach(fig(who), limb, resolve(to, offset), pole ?? named[elbow]);
      return err > 0.03 ? `${who}.${limb} は ${Math.round(err * 100)}cm 届かない` : null;
    },
    look({ who, to }) {
      look(fig(who), resolve(to));
    },
    ground({ who = 'both' }) {
      for (const w of whos(who)) fig(w).ground();
    },
  };

  function apply(ops) {
    const log = [];
    for (const op of ops) {
      const h = handlers[op.op];
      try {
        if (!h) throw new Error(`unknown op: ${op.op}`);
        const note = h(op);
        log.push(note ? `△ ${op.op}: ${note}` : `○ ${op.op}`);
      } catch (e) {
        log.push(`× ${op.op}: ${e.message}`);
      }
      for (const f of Object.values(figs)) f.root.updateMatrixWorld(true);
    }
    return log;
  }
  // 機能ごとに操作を足す口: apply.handlers.foo = ({who, ...}) => note | null
  apply.handlers = handlers;
  apply.resolve = resolve;
  return apply;
}

// 肩甲帯と姿勢: 鎖骨・肩甲骨の自動の動き（肩甲上腕リズム）と、姿勢（胸を開く・背を丸める・すくめる・首を前へ）の角度。
// 座標は chest のローカル（体は +Z を向き、Y が上）。角度は度。
import * as THREE from 'three';

const D2R = Math.PI / 180;
const { clamp } = THREE.MathUtils;

// 静止形での位置（chest ローカル、x は左を +）。胸鎖関節・肩鎖関節・肩関節・肩甲骨の中心・胸郭の軸
export const SC = (s) => [s * 0.018, 0.216, 0.07];
export const AC = (s, sw) => [s * (sw - 0.02), 0.24, -0.004];
const RIB = [0, -0.01]; // 胸郭の軸の [x, z]
// 肩甲骨を胸郭に沿わせるときに合わせる点: 中心・下角・上角・外の縁の中ほど
const WRAP_PTS = (s, w) => [[0.092 * w, 0.13, -0.08], [0.095 * w, 0.062, -0.086], [0.06 * w, 0.2, -0.088], [0.125 * w, 0.11, -0.066]].map(([x, y, z]) => [s * x, y, z]);

// 鎖骨の角度の全体の範囲（手動・リズム・姿勢を足した後）
const TOTAL = [[-15, 50], [-40, 40]];

// 腕の向き d（chest の座標、単位ベクトル）から、肩甲帯が受け持つ角度。
//   up: 腕を 30° より上げた分の 1/upDiv（肩甲骨の上方回旋）。30° の付近は滑らかにつなぐ
//   protract: 腕を前・内へ出すと前へ、後ろへ引くと後ろへ（水平の成分の大きさで効く）。腕の水平の向き 1° あたり protractK 度、範囲 protract。
//     後ろへは 1° あたり retractK 度と強く、肩の高さから離れるほど弱い（上げ 30° と 150° で retractLow 倍、90〜100° で 1 倍）。
//     頭の上へ上げた腕まで強く寄せると、reach の候補選びが腕を前へ回す解へ替わった（頭に手を乗せる、肘を外へ）
//     腕を肩の高さで後ろへ引くと肩甲骨は背骨へ寄る（後ろ 40° で 18°、56° 以上で 25°）。下ろした腕を後ろへ振るだけでは大きく寄らない
// 鎖骨の挙上は up × clavUp、肩甲骨の上方回旋は up × scapUp。wrapW: 肩甲骨を胸郭に沿わせるときの WRAP_PTS の重み
const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const RHYTHM = { upDiv: 3, clavUp: 0.35, scapUp: 0.75, protractK: 0.2, retractK: 0.45, retractLow: 0.5, protract: [-25, 25], wrapW: [1, 1, 1, 1] };
export function rhythm(d, s) {
  const theta = Math.acos(clamp(-d.y, -1, 1)) / D2R;
  const x = theta - 30;
  const up = 0.5 * (x + Math.hypot(x, 12)) / RHYTHM.upDiv;
  const h = Math.hypot(d.x, d.z);
  let phi = Math.atan2(d.z, s * d.x) / D2R; // 0: 真横, 90: 前, 180: 体の前を横切る, -90: 後ろ
  if (phi < -150) phi += 360;
  const lift = RHYTHM.retractLow + (1 - RHYTHM.retractLow) * smooth01((theta - 30) / 60) * (1 - smooth01((theta - 100) / 50));
  const protract = h * (phi < 0 ? lift * clamp(phi * RHYTHM.retractK, ...RHYTHM.protract) : clamp(phi * RHYTHM.protractK, ...RHYTHM.protract));
  return { up, protract };
}

// 姿勢 → [鎖骨 elevate, protract] の上乗せ
export function posturalClavicle({ chest = 0, shrug = 0 }) {
  const open = Math.max(0, chest), round = Math.max(0, -chest);
  return [-5 * open + 4 * round + 28 * shrug, -25 * open + 22 * round];
}

// 姿勢 → 体幹の関節の前屈（semantic の 1 要素目）の上乗せ。
// 背を丸める: 胸椎を主に曲げ、首は前へ、頭は起こして視線を保つ。胸を開く: 胸椎を反らし、顎を引く。
// 首を前へ: 首の付け根を前へ曲げ、頭（上位頸椎）は同じだけ起こす（顔の向きを保ったまま頭が前へ出る）
export function posturalAxial({ chest = 0, neck = 0 }) {
  const open = Math.max(0, chest), round = Math.max(0, -chest);
  return {
    spine: 10 * round - 4 * open,
    chest: 20 * round - 10 * open,
    neck: 6 * round - 6 * open + 20 * neck,
    head: -28 * round + 20 * open - 22 * neck,
  };
}

const Y = new THREE.Vector3(0, 1, 0);
const tmp = { q0: new THREE.Quaternion(), q1: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, 'XZY') };

// 片側の肩甲帯を姿勢と腕の向きから決める。Figure の鎖骨の updateMatrix から毎回呼ばれる。
//   鎖骨: 手動の値（getJoint が返す）+ リズム + 姿勢。全体を TOTAL に収める
//   肩の土台: 鎖骨の回転を打ち消し、肩の semantic が「胸に対する腕の向き」のままになるようにする。
//     さらにリズムで肩が動いた分だけ腕を肩のまわりに回し、手首をリズムなしの位置へ向け直す
//   肩甲骨: 肩鎖関節を中心に、上方回旋し、胸郭の丸みに沿うよう縦軸で回り（前へ出すと胸郭を回り込む）、後傾で下角を胸郭へ戻す
export function updateGirdle(fig, n) {
  const s = n === 'left' ? 1 : -1;
  const { j } = fig;
  const cl = j[`${n}Clavicle`], sc = j[`${n}Scapula`], base = fig.base[n], sh = j[`${n}Shoulder`], el = j[`${n}Elbow`], wr = j[`${n}Wrist`];
  if (!wr) return;
  const d = new THREE.Vector3(0, -1, 0).applyQuaternion(sh.quaternion);
  const r = fig.rhythm ? rhythm(d, s) : { up: 0, protract: 0 };
  const post = posturalClavicle(fig.posture);
  const manual = fig.getJoint(cl.name);
  const total = (rh) => [0, 1].map((i) => clamp(manual[i] + post[i] + rh[i], ...TOTAL[i]));
  const t1 = total([RHYTHM.clavUp * r.up, r.protract]), t0 = total([0, 0]);
  fig.off[cl.name] = [t1[0] - manual[0], t1[1] - manual[1], 0];
  const quat = (t, q) => q.setFromEuler(tmp.e.set(0, -s * t[1] * D2R, s * t[0] * D2R, 'XZY'));
  cl.rotation.set(0, -s * t1[1] * D2R, s * t1[0] * D2R);
  const Q1 = quat(t1, tmp.q1), Q0 = quat(t0, tmp.q0);

  // 腕の向け直し（鎖骨の座標 = chest の向き、原点は胸鎖関節）
  const G1 = base.position.clone().applyQuaternion(Q1), G0 = base.position.clone().applyQuaternion(Q0);
  const a = wr.position.clone().applyQuaternion(el.quaternion).add(el.position).applyQuaternion(sh.quaternion);
  const W0 = G0.clone().add(a);
  const fix = new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), W0.sub(G1).normalize());
  base.quaternion.copy(Q1).invert().multiply(fix);

  // 肩甲骨
  const w = fig.scapW ?? 1;
  const sw = fig.b.sw;
  const scp = SC(s), acp = AC(s, sw);
  const acRest = new THREE.Vector3(acp[0] - scp[0], acp[1] - scp[1], acp[2] - scp[2]);
  const acNow = acRest.clone().applyQuaternion(Q1).add(new THREE.Vector3(...scp));
  // 肩鎖関節を中心に回すと下角が大きく振れるので、上方回旋は肩甲帯の受け持ちの 3/4（170° で約 35°、下角は外へ約 10cm）
  const alpha = RHYTHM.scapUp * r.up + 0.25 * Math.max(0, t0[0]);
  const nrm = new THREE.Vector3(s * 0.5, 0, -0.87).normalize();
  const up = new THREE.Quaternion().setFromAxisAngle(nrm, -s * alpha * D2R);
  // 胸郭に沿う縦軸の回転は、上方回旋の前の形の中心が胸郭の水平断の円に乗るように決める（前へ出すと胸郭を回り込む）
  const sp = WRAP_PTS(s, w)[0];
  const v = new THREE.Vector3(sp[0] - acp[0], sp[1] - acp[1], sp[2] - acp[2]);
  const r0 = Math.hypot(sp[0] - RIB[0], sp[2] - RIB[1]);
  const rho = Math.hypot(v.x, v.z);
  const dx = RIB[0] - acNow.x, dz = RIB[1] - acNow.z, D = Math.hypot(dx, dz);
  const cb = clamp((D * D + rho * rho - r0 * r0) / (2 * D * rho), -1, 1);
  const thC = Math.atan2(dz, dx), thV = Math.atan2(v.z, v.x), beta = Math.acos(cb);
  const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  const cand = [thC + beta, thC - beta].sort((p, q) => Math.abs(wrap(p - thV)) - Math.abs(wrap(q - thV)))[0];
  const psi = wrap(thV - cand);
  const Qy = new THREE.Quaternion().setFromAxisAngle(Y, psi);
  // 上方回旋で下角が外へ振れて胸郭から浮く分は、肩甲棘に沿う横軸で後ろへ傾けて（後傾）板の下を胸郭へ戻す。
  // 傾きは WRAP_PTS の胸郭の軸からの距離が静止形に近くなるよう最小二乗で決める。
  // 縦軸の回転だけで戻すと、肩鎖関節のまわりの回転は胸郭の円にほぼ沿う向きなので 50〜70° も回り、板が腋へ滑って背に穴が開いた
  const hx = new THREE.Vector3().crossVectors(nrm, Y).normalize().applyQuaternion(Qy);
  const pts = WRAP_PTS(s, w).map((p) => new THREE.Vector3(p[0] - acp[0], p[1] - acp[1], p[2] - acp[2]).applyQuaternion(up).applyQuaternion(Qy));
  const r0s = WRAP_PTS(s, w).map((p) => Math.hypot(p[0] - RIB[0], p[2] - RIB[1]));
  const qt = new THREE.Quaternion(), pv = new THREE.Vector3();
  const cost = (tau) => {
    qt.setFromAxisAngle(hx, tau);
    let e = 0;
    pts.forEach((p, i) => { pv.copy(p).applyQuaternion(qt).add(acNow); e += RHYTHM.wrapW[i] * (Math.hypot(pv.x - RIB[0], pv.z - RIB[1]) - r0s[i]) ** 2; });
    return e;
  };
  let tau = 0, best = cost(0);
  const dir = cost(0.01) < best ? 1 : -1;
  for (let t = dir * 0.02; Math.abs(t) < 0.8; t += dir * 0.02) { const e = cost(t); if (e >= best) break; best = e; tau = t; }
  for (let h = 0.01; h > 1e-4; h *= 0.5) for (const t of [tau - h, tau + h]) { const e = cost(t); if (e < best) { best = e; tau = t; } }
  const Qs = qt.setFromAxisAngle(hx, tau).multiply(Qy).multiply(up);
  sc.quaternion.copy(Q1).invert().multiply(Qs);
}

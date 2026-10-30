// カメラのレンズ: 焦点距離（35mm 判換算）、魚眼、ロール。
// 魚眼はカメラ位置のキューブマップを全画面の四角形へ射影し直して描く。
import { Figure, outlineUniforms } from '../figure.js';

const D2R = Math.PI / 180;
const FOCALS = [14, 18, 24, 35, 50, 85, 135, 200];
const VIEWS = ['front', 'high', 'low', 'side', 'diag'];
const VIEW_DIST = 4.2; // app.js の setView が 35mm で置く距離
const PROJ = { equidistant: '等距離', stereographic: '立体射影', equisolid: '等立体角' };
const FRAME = { circular: '全周魚眼', full: '対角魚眼' };
// 魚眼の射影 r = f·g(θ) と、その逆
const G = {
  equidistant: (t) => t,
  stereographic: (t) => 2 * Math.tan(t / 2),
  equisolid: (t) => 2 * Math.sin(t / 2),
};
const G_INV = {
  equidistant: (u) => u,
  stereographic: (u) => 2 * Math.atan(u / 2),
  equisolid: (u) => 2 * Math.asin(Math.min(1, u / 2)),
};

const vfov = (focal) => 2 * Math.atan(12 / focal) / D2R;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// レンズの項目 → 値を読む関数。読めない値は Error
const num = (lo, hi) => (x) => {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`${lo}〜${hi} の数値`);
  return clamp(x, lo, hi);
};
const bool = (x) => {
  if (typeof x !== 'boolean') throw new Error('true か false');
  return x;
};
const oneOf = (o) => (x) => {
  if (!Object.hasOwn(o, x)) throw new Error(Object.keys(o).join('|'));
  return x;
};
const FIELDS = {
  focal: num(14, 200), keepDist: bool, fisheye: bool, angle: num(120, 220),
  proj: oneOf(PROJ), frame: oneOf(FRAME), roll: num(-45, 45),
};
// 省略した項目は含めない。onBad(項目, 値, Error) が読めない項目を扱う
function parseLens(src, onBad) {
  const out = {};
  for (const [k, parse] of Object.entries(FIELDS)) {
    if (src?.[k] == null) continue;
    try { out[k] = parse(src[k]); } catch (e) { onBad(k, src[k], e); }
  }
  return out;
}

export default function init(ctx) {
  const { THREE, scene, camera, renderer, canvas, orbit, tc, figs } = ctx;
  const L = { focal: 35, keepDist: false, fisheye: false, angle: 180, proj: 'equidistant', frame: 'circular', roll: 0 };

  // ---- 見かけの大きさ: 画面中心での 1 ラジアンあたりの画素数
  const fisheyeCircle = (w, h, l = L) => {
    const R = l.frame === 'full' ? Math.hypot(w, h) / 2 : Math.min(w, h) / 2;
    return { R, f: R / G[l.proj](l.angle * D2R / 2) };
  };
  const pxPerRad = (l = L) => {
    const { clientWidth: w, clientHeight: h } = canvas;
    return l.fisheye ? fisheyeCircle(w, h, l).f : h / 2 / Math.tan(vfov(l.focal) * D2R / 2);
  };
  const dist = () => camera.position.distanceTo(orbit.target);
  const setDist = (d) => {
    const dir = camera.position.clone().sub(orbit.target).normalize();
    camera.position.copy(orbit.target).addScaledVector(dir, d);
    camera.far = Math.max(100, d * 4);
    camera.updateProjectionMatrix();
  };
  const viewDist = () => VIEW_DIST * pxPerRad() / pxPerRad({ focal: 35 });

  function set(next) {
    const before = pxPerRad();
    Object.assign(L, next);
    camera.fov = vfov(L.focal);
    setDist(L.keepDist ? dist() : dist() * pxPerRad() / before);
    tc.enabled = !L.fisheye;
    ctx.setRender(L.fisheye ? renderFisheye : renderPlain);
    sync();
  }
  // シーンの保存・元に戻すに含める。人形ごとの状態なので女性の側に持たせる
  Figure.stateHooks.push({
    key: 'camera',
    get: (fig) => (fig === figs.female ? { ...L } : undefined),
    set: (fig, v) => { if (fig === figs.female) set(parseLens(v, () => {})); },
  });

  function view(name, prev = dist()) {
    ctx.setView(name);
    setDist(L.keepDist ? prev : viewDist());
  }
  // app.js の視点ボタンは 35mm の距離へ置くので、直後にレンズに合わせて置き直す
  let lastDist = dist();
  document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => view(b.dataset.cam, lastDist)));
  document.getElementById('reset').addEventListener('click', () => view('diag', lastDist));

  // ---- ロール: OrbitControls.update の lookAt が毎フレーム消すので、その後で掛け直す
  ctx.onFrame(() => {
    camera.lookAt(orbit.target);
    camera.rotateZ(L.roll * D2R);
    camera.updateMatrixWorld();
    lastDist = dist();
  });

  // ---- 描画
  const renderPlain = () => renderer.render(scene, camera);
  let cubeRT = null;
  let cubeCam = null;
  const quadMat = new THREE.ShaderMaterial({
    uniforms: {
      uCube: { value: null }, uRes: { value: new THREE.Vector2() },
      uR: { value: 1 }, uF: { value: 1 }, uProj: { value: 0 },
    },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform samplerCube uCube; uniform vec2 uRes; uniform float uR, uF; uniform int uProj;
      void main() {
        vec2 p = gl_FragCoord.xy - uRes * 0.5;
        float r = length(p);
        if (r > uR) { gl_FragColor = vec4(1.0); return; }
        float u = r / uF;
        float t = uProj == 0 ? u : uProj == 1 ? 2.0 * atan(u * 0.5) : 2.0 * asin(min(1.0, u * 0.5));
        float phi = atan(p.y, p.x + 1e-6);
        gl_FragColor = textureCube(uCube, vec3(sin(t) * cos(phi), sin(t) * sin(phi), -cos(t)), -0.7);
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene().add(quad);
  const quadCam = new THREE.OrthographicCamera();
  const buf = new THREE.Vector2();

  function renderFisheye() {
    const { x: w, y: h } = renderer.getDrawingBufferSize(buf);
    const { R, f } = fisheyeCircle(w, h);
    // 画面中心でキューブ面の 2 画素が出力の 1 画素に当たる大きさ（縮小で滑らかにする）
    const size = clamp(Math.round(f * 4 / 128) * 128, 512, 2048);
    if (cubeRT?.width !== size) {
      cubeRT?.dispose();
      cubeRT = new THREE.WebGLCubeRenderTarget(size, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, colorSpace: THREE.SRGBColorSpace });
      cubeCam = new THREE.CubeCamera(camera.near, camera.far, cubeRT);
    }
    for (const c of cubeCam.children) { c.near = camera.near; c.far = camera.far; c.updateProjectionMatrix(); }
    // キューブをカメラと同じ向きにして、画面の中央を前の面の中央に置く。方向はカメラ座標のまま引ける
    camera.matrixWorld.decompose(cubeCam.position, cubeCam.quaternion, cubeCam.scale);

    // 輪郭線の太さは画素で決まるので、キューブ面の画素に換算する。
    // 面の端で細る分は uWarp で太らせ、縮小で薄まる分だけ少し太めに描く
    const { uRes, uPx, uWarp } = outlineUniforms;
    const keep = [uRes.value.clone(), uPx.value];
    uRes.value.set(size, size);
    uPx.value = Math.max(1, keep[1] * size / 2 / f * 1.2);
    uWarp.value = 1;
    const helper = tc.getHelper();
    const hv = helper.visible;
    helper.visible = false;
    cubeCam.update(renderer, scene);
    helper.visible = hv;
    uRes.value.copy(keep[0]);
    uPx.value = keep[1];
    uWarp.value = 0;

    const u = quadMat.uniforms;
    u.uCube.value = cubeRT.texture;
    u.uRes.value.set(w, h);
    u.uR.value = R;
    u.uF.value = f;
    u.uProj.value = Object.keys(PROJ).indexOf(L.proj);
    renderer.render(quadScene, quadCam);
  }

  // 魚眼の画面上の点 → ワールドの向き。像の外なら null
  function fisheyeRay(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const px = clientX - r.left - r.width / 2;
    const py = r.height / 2 - (clientY - r.top);
    const { R, f } = fisheyeCircle(r.width, r.height);
    const rr = Math.hypot(px, py);
    if (rr > R) return null;
    const t = G_INV[L.proj](rr / f);
    const phi = Math.atan2(py, px);
    return new THREE.Vector3(Math.sin(t) * Math.cos(phi), Math.sin(t) * Math.sin(phi), -Math.cos(t)).transformDirection(camera.matrixWorld);
  }

  // ---- 魚眼での関節の選択。app.js の透視投影での判定の後に選び直す
  const ray = new THREE.Raycaster();
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!L.fisheye || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const d = fisheyeRay(e.clientX, e.clientY);
    let hit = null;
    if (d) {
      ray.set(new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld), d);
      hit = ray.intersectObjects(Object.values(figs).flatMap((g) => g.meshes), false)[0];
    }
    ctx.select(hit?.object.userData.fig ?? null, hit?.object.userData.joint);
  });

  // ---- パネル
  const options = (o) => Object.entries(o).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  const fs = document.createElement('fieldset');
  fs.innerHTML = `<legend>カメラ</legend>
    <label>焦点距離 <input name="focal" type="range" min="0" max="${FOCALS.length - 1}" step="1"><span name="focalV"></span></label>
    <label class="check"><input name="keepDist" type="checkbox">距離を保って画角だけ変える</label>
    <label class="check"><input name="fisheye" type="checkbox">魚眼</label>
    <label>魚眼の画角 <input name="angle" type="range" min="120" max="220" step="5"><span name="angleV"></span></label>
    <label>射影 <select name="proj">${options(PROJ)}</select></label>
    <label>写る範囲 <select name="frame">${options(FRAME)}</select></label>
    <label>ロール <input name="roll" type="range" min="-45" max="45" step="1"><span name="rollV"></span></label>`;
  ctx.panel.append(fs);
  const el = (n) => fs.querySelector(`[name=${n}]`);
  for (const n of ['focalV', 'angleV', 'rollV']) el(n).style.cssText = 'width: 3.6em; text-align: right; white-space: nowrap;';
  for (const c of fs.querySelectorAll('.check')) c.style.justifyContent = 'flex-start';
  for (const n of ['focal', 'angle', 'roll']) el(n).style.width = '76px';
  for (const l of fs.querySelectorAll('label')) l.style.whiteSpace = 'nowrap';
  // スライダーを動かし始めたときに一度だけ元に戻す点を積み、離したときに保存する
  let editing = false;
  const edit = (next) => {
    if (!editing) ctx.pushUndo();
    editing = true;
    set(next);
  };
  fs.addEventListener('change', () => { editing = false; ctx.persist(); });
  const on = (n, read) => el(n).addEventListener('input', (e) => edit({ [n]: read(e.target) }));
  on('focal', (t) => FOCALS[+t.value]);
  on('keepDist', (t) => t.checked);
  on('fisheye', (t) => t.checked);
  on('angle', (t) => +t.value);
  on('proj', (t) => t.value);
  on('frame', (t) => t.value);
  on('roll', (t) => +t.value);
  el('roll').addEventListener('dblclick', () => { edit({ roll: 0 }); editing = false; ctx.persist(); });
  function sync() {
    const near = FOCALS.reduce((a, b) => (Math.abs(Math.log(b / L.focal)) < Math.abs(Math.log(a / L.focal)) ? b : a));
    el('focal').value = FOCALS.indexOf(near);
    el('focalV').textContent = `${Math.round(L.focal)}mm`;
    el('keepDist').checked = L.keepDist;
    el('fisheye').checked = L.fisheye;
    el('angle').value = L.angle;
    el('angleV').textContent = `${L.angle}°`;
    el('proj').value = L.proj;
    el('frame').value = L.frame;
    el('roll').value = L.roll;
    el('rollV').textContent = `${L.roll}°`;
    el('focal').disabled = L.fisheye;
    for (const n of ['angle', 'proj', 'frame']) el(n).disabled = !L.fisheye;
  }

  // ---- 操作（apply）
  const OP_NAME = { angle: 'fisheyeAngle', proj: 'projection' };
  ctx.apply.handlers.camera = ({ view: v, focal, fisheye, fisheyeAngle, projection, frame, roll }) => {
    if (v != null && !VIEWS.includes(v)) throw new Error(`view は ${VIEWS.join('|')}: ${v}`);
    const next = parseLens({ focal, fisheye, angle: fisheyeAngle, proj: projection, frame, roll }, (k, x, e) => {
      throw new Error(`${OP_NAME[k] ?? k} は ${e.message}: ${JSON.stringify(x)}`);
    });
    set(next);
    if (v) view(v);
  };

  set({});
  setDist(L.keepDist ? dist() : viewDist());
}

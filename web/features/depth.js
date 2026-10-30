// 奥行きの表示: 手前ほど白く、奥ほど黒く塗る（背景は黒）。キャラのみ: 人形の手前から奥まで。地面含む: 床（格子の範囲）も塗り、濃淡は床まで含めた手前から奥まで
const VERT = `
#include <common>
#include <skinning_pars_vertex>
varying float vDepth;
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform float uNear, uFar;
varying float vDepth;
void main() {
  float g = 1.0 - clamp((vDepth - uNear) / max(uFar - uNear, 1e-4), 0.0, 1.0);
  gl_FragColor = vec4(vec3(g), 1.0);
}`;

export default function init(ctx) {
  const { THREE, scene, camera, figs } = ctx;
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uNear: { value: 0 }, uFar: { value: 1 } } });
  const MODES = ['off', 'figs', 'ground'];
  const LABEL = { off: '非表示', figs: 'キャラのみ', ground: '地面含む' };
  let mode = 'off';
  // 床: 格子と同じ 6m 四方の板。地面含むのときだけ見せる
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
  floor.visible = false;
  floor.raycast = () => {};
  scene.add(floor);
  const hidden = [];
  let bg = null;

  // 濃淡の邪魔になるもの（輪郭線、格子、床の影、ハンドル、ギズモ）を隠す。輪郭線は ShaderMaterial、ハンドルと線は depthTest を切った材質
  const hideClutter = () => {
    scene.traverse((o) => {
      const m = o.material;
      const clutter = o.isGridHelper || o.type === 'GridHelper' || m?.isShadowMaterial || (m && m.depthTest === false)
        || (o.isMesh && m?.isShaderMaterial && m !== mat) || o.isTransformControlsRoot || o.isLine;
      if (clutter && o.visible && o !== floor) { o.visible = false; hidden.push(o); }
    });
  };
  const restore = () => { for (const o of hidden.splice(0)) o.visible = true; };

  const set = (m) => {
    const was = mode;
    mode = m;
    btn.textContent = `奥行き: ${LABEL[mode]}`;
    floor.visible = mode === 'ground';
    if (mode !== 'off' && was === 'off') {
      bg = scene.background;
      scene.background = new THREE.Color(0x000000);
      scene.overrideMaterial = mat;
    } else if (mode === 'off' && was !== 'off') {
      restore();
      scene.background = bg ?? scene.background;
      scene.overrideMaterial = null;
    }
  };

  ctx.onFrame(() => {
    if (mode === 'off') return;
    restore();
    hideClutter();
    // 見えている人形の各部品の箱の角を視点の奥行きに直し、その最小と最大を白と黒に割り当てる
    let lo = Infinity, hi = -Infinity;
    const v = new THREE.Vector3(), view = camera.matrixWorldInverse;
    for (const f of Object.values(figs)) {
      if (!f.root.visible) continue;
      for (const m of f.meshes) {
        if (m.userData.proxy || !m.geometry) continue;
        m.geometry.boundingBox ?? m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox;
        for (let i = 0; i < 8; i++) {
          v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(m.matrixWorld).applyMatrix4(view);
          lo = Math.min(lo, -v.z); hi = Math.max(hi, -v.z);
        }
      }
    }
    if (mode === 'ground') {
      floor.geometry.boundingBox ?? floor.geometry.computeBoundingBox();
      const bb = floor.geometry.boundingBox;
      for (let i = 0; i < 4; i++) {
        v.set(i & 1 ? bb.max.x : bb.min.x, 0, i & 2 ? bb.max.z : bb.min.z).applyMatrix4(view);
        // 床はカメラの後ろへも続くので、手前の端は人形の手前より近くしない
        hi = Math.max(hi, -v.z);
      }
    }
    if (lo === Infinity) return;
    mat.uniforms.uNear.value = Math.max(camera.near, lo);
    mat.uniforms.uFar.value = hi;
  });

  const btn = document.createElement('button');
  btn.addEventListener('click', () => set(MODES[(MODES.indexOf(mode) + 1) % MODES.length]));
  set('off');
  ctx.bar.append(btn);
  ctx.depth = { get mode() { return mode; }, set mode(m) { if (MODES.includes(m) && m !== mode) set(m); } };
}

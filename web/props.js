// 床に置く小物（壁と箱）。どれも床に接地した直方体で、位置は床の上の x, z と縦軸の回転 ry、大きさは幅 w・高さ h・奥行き d（m）
import * as THREE from 'three';

export const KINDS = {
  wall: { label: '壁', size: [3, 2.4, 0.1], at: [0, -0.9], color: 0xe6e6e6 },
  box: { label: '箱', size: [0.5, 0.45, 0.5], at: [1.1, -0.2], color: 0xc8c8c8 },
};
const UNIT = new THREE.BoxGeometry(1, 1, 1);
const EDGES = new THREE.EdgesGeometry(UNIT);
const LINE = new THREE.LineBasicMaterial({ color: 0x555555 });
const HI = new THREE.MeshLambertMaterial({ color: 0xd9a35a });

export class Prop {
  constructor(kind) {
    this.kind = kind;
    this.mat = new THREE.MeshLambertMaterial({ color: KINDS[kind].color });
    this.mesh = new THREE.Mesh(UNIT, this.mat);
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.userData.prop = this;
    const edges = new THREE.LineSegments(EDGES, LINE);
    edges.raycast = () => {};
    this.mesh.add(edges);
    this.set({ size: KINDS[kind].size, pos: KINDS[kind].at, ry: 0 });
  }

  get size() { return this.mesh.scale.toArray(); }

  /** 一部だけ渡してもよい。高さが変わっても底は床に置いたまま */
  set({ size = this.size, pos = [this.mesh.position.x, this.mesh.position.z], ry = this.mesh.rotation.y }) {
    this.mesh.scale.set(...size);
    this.mesh.position.set(pos[0], size[1] / 2, pos[1]);
    this.mesh.rotation.set(0, ry, 0);
  }

  /** ギズモで動かした後、床から浮いたり傾いたりしないように戻す */
  settle() { this.set({}); }

  getState() {
    const r = (x) => Math.round(x * 1000) / 1000;
    return { kind: this.kind, size: this.size.map(r), pos: [r(this.mesh.position.x), r(this.mesh.position.z)], ry: r(this.mesh.rotation.y) };
  }

  setTint(on) { this.mesh.material = on ? HI : this.mat; }

  get label() { return KINDS[this.kind].label; }
}

/** scene に小物の置き場を作る。list は置いた順 */
export function createProps(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const list = [];
  const add = (kind, state) => {
    const p = new Prop(kind);
    if (state) p.set(state);
    else {
      // 同じ種類を続けて置いたら少しずらす
      const n = list.filter((q) => q.kind === kind).length;
      const [x, z] = KINDS[kind].at;
      p.set({ pos: [x + 0.3 * n, z + 0.3 * n] });
    }
    list.push(p);
    group.add(p.mesh);
    return p;
  };
  const remove = (p) => {
    list.splice(list.indexOf(p), 1);
    p.mesh.removeFromParent();
  };
  return {
    group, list, add, remove,
    meshes: () => list.map((p) => p.mesh),
    getState: () => list.map((p) => p.getState()),
    setState(states) {
      for (const p of [...list]) remove(p);
      for (const s of states) if (KINDS[s.kind]) add(s.kind, s);
    },
  };
}

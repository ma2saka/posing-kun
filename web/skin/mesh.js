// Worker の結果を人形の関節に結びつけた SkinnedMesh にする。
// 骨は人形の関節の Group そのもの。頂点は静止形の root 座標で、骨の逆行列は静止形の関節行列の逆。
import * as THREE from 'three';
import { gradient } from '../figure.js';

const skeletonOf = (fig, spec) => new THREE.Skeleton(spec.bones.map((n) => fig.j[n]), spec.bones.map((n) => spec.frames[n].clone().invert()));

// 解剖の表示: 骨（象牙色）と筋（くすんだ赤）を、皮膚と同じ関節に結びつけた 2 つの SkinnedMesh にする
const ANATOMY = { bone: 0xe8e0c8, muscle: 0xa8564c };
export function createAnatomy(fig, spec, meshes) {
  const group = new THREE.Group();
  group.name = 'anatomy';
  const skeleton = skeletonOf(fig, spec);
  for (const [key, m] of Object.entries(meshes)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(m.skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(m.skinWeight, 4));
    g.setIndex(new THREE.BufferAttribute(m.index, 1));
    g.userData.owner = m.owner;
    const mesh = new THREE.SkinnedMesh(g, new THREE.MeshToonMaterial({ color: ANATOMY[key], gradientMap: gradient }));
    mesh.bind(skeleton, new THREE.Matrix4());
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    mesh.name = key;
    group.add(mesh);
  }
  return group;
}

// 皮膚を透かす（解剖の表示）。線は消し、奥の骨と筋が見えるように深度を書かない

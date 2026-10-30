// 解剖の表示（骨と筋）のメッシュを UI の外で作る。{ id, parts, edges, grids: {anatomy} } → 骨と筋のメッシュと重み
import { extract, select, smoothWeights, weights } from './sdf.js';

function mesh(parts, edges, grid, layers) {
  const m = extract(parts, edges, grid, 'body', layers, null);
  Object.assign(m, weights(parts, edges, m.position, select(parts, edges, 'body', layers).ids));
  smoothWeights(m.index, m.skinIndex, m.skinWeight, Uint8Array.from(m.owner, (o) => +parts[o].hand));
  return m;
}

onmessage = ({ data: { id, parts, edges: allEdges, grids } }) => {
  const t0 = performance.now();
  // 骨と筋は一つずつの形が読めるよう、結合の幅を半分にする
  const edges = allEdges.map((e) => [e[0], e[1], e[2] * 0.5, ...e.slice(3)]);
  const meshes = { bone: mesh(parts, edges, grids.anatomy, ['bone']), muscle: mesh(parts, edges, grids.anatomy, ['muscle']) };
  const list = Object.values(meshes).flatMap((m) => [m.position.buffer, m.normal.buffer, m.index.buffer, m.skinIndex.buffer, m.skinWeight.buffer]);
  postMessage({ id, meshes, ms: Math.round(performance.now() - t0) }, list);
};

// 人形の股関節まわりの面を UI の外で取り出す。{ id, parts, edges, grid, clip } → { id, position, normal, index }
import { extract } from './skin/sdf.js';

onmessage = ({ data: { id, parts, edges, grid, clip } }) => {
  const m = extract(parts, edges, grid, 'body', null, null, clip);
  postMessage({ id, position: m.position, normal: m.normal, index: m.index }, [m.position.buffer, m.normal.buffer, m.index.buffer]);
};

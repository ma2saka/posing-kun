// 機能の一覧。各機能は init(ctx) を default export する。ctx の中身は app.js の「機能の差し込み」を見る。
import ikdrag from './ikdrag.js';
import body from './body.js';
import hands from './hands.js';
import lens from './lens.js';
import anatomy from './anatomy.js';
import posture from './posture.js';
import focus from './focus.js';
import hair from './hair.js';
import depth from './depth.js';
import room from './room.js';

export default [body, posture, hands, ikdrag, lens, anatomy, focus, hair, room, depth];

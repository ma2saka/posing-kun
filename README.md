# posing-kun

ブラウザで動く、ポーズ作りの道具です。マネキンの造形で、IK ハンドルとギズモで手で動かします。ControlNetの入力に使ったりできます。

HTML/JSのみで実装され、外部通信がありません。

100% AI Coding

## できること

- IK ハンドル: 手足・肘・膝・腰・胸・背中・視線を引いて姿勢を作る
- ギズモ: 部位をクリックして関節を回す（手首・足首は 3 軸、足の指も曲がる）
- 体型（身長・肩幅・腰幅・筋肉・脂肪・胸）と姿勢（胸を開く・背を丸める・すくめる・首を前へ）
- カメラの焦点距離・魚眼・ロール、JSON の保存と読み込み、PNG 保存

## 動かす

ビルドは要りません。`web/` を静的ファイルとして配信して開きます。three.js は jsdelivr の CDN（0.170.0）から読みます。

```sh
cd web && python3 -m http.server 8000
# http://localhost:8000/
```

## 仕組み

- 骨格と関節の角度: `web/figure.js`（関節は意味の付いた 3 値。肩甲帯の連動は `web/girdle.js`）
- 人形の形: `web/doll.js`。部品ごとに閉じた形を距離場から面にする（`web/skin/sdf.js`）。女性の胴は高さごとの断面を積み重ね、背骨の曲線に沿って曲げる。股関節まわりは姿勢ごとに Worker（`web/doll-worker.js`）で面を取り直す
- 解剖: 骨と筋の形（`web/skin/anatomy.js`）を人形の関節に結びつける（`web/skin/parts.js`、`worker.js`、`mesh.js`）。肩をまたぐ筋は姿勢ごとに張り直す
- 機能は `web/features/*.js` の `init(ctx)`。操作列は `web/ops.js` の `apply`（ブラウザのコンソールから `pp.apply([...])` でも使える）

## ライセンス

MIT

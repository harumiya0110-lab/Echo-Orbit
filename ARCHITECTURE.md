## Echo Orbit - システムアーキテクチャ

### 全体構成

```
┌─────────────────────────────────────┐
│   Cloudflare Pages                  │
│   (フロントエンド)                   │
│ - index.html                        │
│ - game.js (ゲームロジック)            │
│ - style.css                         │
│ - WebSocket クライアント             │
└────────────────┬────────────────────┘
                 │ wss://
                 │
┌────────────────▼────────────────────┐
│   Railway                           │
│   (バックエンド)                      │
│ - server.js (WebSocket サーバー)    │
│ - マッチメイキング機能                │
│ - ルーム管理                         │
│ - プレイヤー状態同期                  │
└─────────────────────────────────────┘
```

### クライアント側の流れ

1. **起動**
   - `index.html` を Cloudflare Pages から読み込み
   - `game.js` が実行される

2. **接続**
   - 「マッチメイキング開始」ボタンをクリック
   - `connectNetwork()` が呼び出される
   - Railway WebSocket サーバーに接続

3. **マッチメイキング**
   - サーバーに `matchmake` メッセージを送信
   - キューで待機

4. **ゲーム開始**
   - 4人揃ったら `matched` メッセージを受信
   - ルーム ID とプレイヤーリストを取得

5. **ゲーム中**
   - ゲームロジック更新（移動、音波など）
   - 125ms ごとに `state_update` を送信
   - 他プレイヤーの位置を `player_update` で受信
   - 描画更新

### サーバー側の流れ

1. **接続受け入れ**
   - クライアントが接続
   - ユニークな playerId を割り当て

2. **マッチメイキング**
   - `matchmake` リクエストを受信
   - プレイヤーをキューに追加
   - 4人揃ったら自動的にルーム作成

3. **ルーム管理**
   - ルームにプレイヤーを追加
   - 全プレイヤーに `players_list` を送信
   - ゲーム開始

4. **状態同期**
   - `state_update` を受信
   - プレイヤー位置情報を更新
   - 同じルーム内の他プレイヤーに`player_update` を送信

5. **イベント処理**
   - `event` メッセージ（音波など）を受信
   - ルーム内ブロードキャスト

6. **切断処理**
   - クライアント切断時にルームから削除
   - ルームが空になったら削除

### ネットワークメッセージ仕様

#### クライアント → サーバー

- **matchmake**
  ```json
  {
    "type": "matchmake"
  }
  ```

- **state_update**
  ```json
  {
    "type": "state_update",
    "playerId": "xxx",
    "x": 450,
    "y": 300,
    "heading": 1.57,
    "moving": true,
    "pulse": false
  }
  ```

- **event**
  ```json
  {
    "type": "event",
    "event": "pulse",
    "x": 450,
    "y": 300
  }
  ```

#### サーバー → クライアント

- **welcome**
  ```json
  {
    "type": "welcome",
    "playerId": "xxx"
  }
  ```

- **matched**
  ```json
  {
    "type": "matched",
    "roomId": 1,
    "playerCount": 4
  }
  ```

- **players_list**
  ```json
  {
    "type": "players_list",
    "players": [
      {"id": "p1", "x": 100, "y": 200, "heading": 0, "moving": false, "pulse": false},
      {"id": "p2", "x": 300, "y": 400, "heading": 1.57, "moving": true, "pulse": false}
    ]
  }
  ```

- **player_update**
  ```json
  {
    "type": "player_update",
    "playerId": "p2",
    "x": 320,
    "y": 410,
    "heading": 1.6,
    "moving": true,
    "pulse": false
  }
  ```

- **event**
  ```json
  {
    "type": "event",
    "playerId": "p1",
    "event": "pulse",
    "x": 450,
    "y": 300
  }
  ```

### パフォーマンス設定

- **送信レート**：125ms（8フレーム）ごと
- **マッチメイキングタイムアウト**：なし（キューで待機）
- **ルーム最大人数**：4人
- **同時接続ルーム数**：無制限

### スケーラビリティ

#### 現在の構成
- Railway 単一インスタンス
- 同時プレイヤー数：数百～千人規模

#### 今後の拡張
- 複数 Railway インスタンス + ロードバランサー
- Redis でセッション管理
- ゲームサーバー分散（複数リージョン）
- データベース（プレイヤー保存、ランキング）

### セキュリティ考慮事項

- [ ] プレイヤー認証（OAuth）
- [ ] レート制限
- [ ] チート対策（サーバー権威）
- [ ] HTTPS / WSS 強制
- [ ] CORS 設定
- [ ] プレイヤーデータ暗号化

### 開発環境での実行

**ローカル サーバー**
```bash
cd Echo\ Orbit
npm install
npm start
```

**ローカル フロントエンド**
- `index.html` をブラウザで開く
- または `python -m http.server 8000` などでローカルサーバーを起動

**ゲームの接続設定**
- `game.js` の `network.backendUrl` を `ws://localhost:3001` に変更

## Railway デプロイ手順

### 1. Railway アカウント作成
- https://railway.app にアクセス
- GitHub アカウントで サインアップ

### 2. 新規プロジェクト作成
- 「新しいプロジェクト」
- 「GitHub リポジトリから」を選択
- このリポジトリを選択

### 3. デプロイ設定
- **Start Command**：`npm start`
- **Node Version**：`18.x` 以上
- **環境変数**：特に不要

### 4. デプロイ完了
- Railway が自動ビルド＆デプロイ
- WebSocket URL：`wss://your-app-name.railway.app`

### 5. URL 確認
- Railway ダッシュボードでドメインを確認
- `game.js` の `network.backendUrl` を更新

## Cloudflare Pages デプロイ手順

### 1. Cloudflare アカウント作成
- https://pages.cloudflare.com にアクセス

### 2. GitHub 接続
- GitHub リポジトリを接続
- `frontend/` などのディレクトリを指定

### 3. ビルド設定
- **ビルドコマンド**：不要（静的ファイルの場合）
- **公開ディレクトリ**：`/`（ルート）

### 4. 環境変数（必要に応じて）
- `VITE_BACKEND_URL = wss://railway-app-url`

### 5. デプロイ完了
- Cloudflare Pages が自動ホスティング
- ゲームURL：`https://your-site.pages.dev`

## 接続確認

1. Cloudflare Pages でゲームを開く
2. 「マッチメイキング開始」をクリック
3. Railway サーバーに接続される

完了！4人マッチングを体験してください。

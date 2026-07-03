# 墨影集

基于 `linuxdo-85w.txt` 构建的图片图集浏览站点，包含首页瀑布流、图集详情、点赞、搜索、随机/顺序浏览和窗口化渲染优化。

## 本地运行

```bash
npm install
npm run build:data
npm start
```

默认监听 `127.0.0.1:26785`，可通过 `PORT` 覆盖。

## 数据

- 源文件：`data/source/linuxdo-85w.txt`
- 构建产物：`data/albums.json`、`data/photos/*.json`、`data/manifest.json`

## 检查

```bash
npm run check
npm run test:photos
npm run test:worker
```

## Cloudflare Workers + D1

Workers 版本使用 `public/` 作为 Static Assets，`src/worker.js` 提供 `/api/*`，D1 保存相册、详情和点赞数据。

测试数据导出：

```bash
npm run export:d1 -- --limit 200 --out data/d1-seed-test.sql
```

完整数据导出：

```bash
npm run export:d1 -- --out data/d1-seed.sql
```

默认导出的 SQL 兼容 D1 remote import，不包含 `BEGIN TRANSACTION`。如果只用于本地 SQLite 调试，可以追加 `--transaction`。

Cloudflare 部署流程：

```bash
npx wrangler d1 create xrw-album-test
# 把返回的 database_id 写入 wrangler.toml
npx wrangler d1 execute xrw-album-test --file migrations/0001_init.sql --remote
npx wrangler d1 execute xrw-album-test --file data/d1-seed-test.sql --remote
npx wrangler deploy
```

本地 Worker API 测试不依赖 Cloudflare 账号：

```bash
npm run test:worker
```

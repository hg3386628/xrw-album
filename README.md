# 墨影集

基于 `linuxdo-85w.txt` 构建的图片图集浏览站点，包含首页瀑布流、图集详情、点赞、搜索、随机/顺序浏览、全部图片瀑布流和窗口化渲染优化。

## 预览

- Workers + D1 测试预览：[https://xrw-album-workers.cfmxy123.workers.dev](https://xrw-album-workers.cfmxy123.workers.dev)

说明：Workers 预览站当前使用 D1 样本数据，用于验证 Cloudflare Workers Static Assets + D1 部署链路。

## 功能

- 黑色背景图片浏览界面
- 首页三个 tab：全部图片、最近更新、随机漫游
- 全部图片瀑布流默认随机，可切换顺序/随机
- 首页和详情页支持无限滚动与预加载
- 详情页支持 100%-300% 图片显示大小，本地持久化
- 相册搜索、点赞、相册详情页
- 大量图片场景下的窗口化渲染，减少 DOM、CPU 和内存占用

## 目录

```text
public/                 前端静态文件
server.js               当前 Node 生产服务
src/worker.js           Cloudflare Worker 入口
src/shared.js           Worker API 共享业务逻辑
data/albums.json        相册列表构建产物
data/photos/*.json      相册详情构建产物
data/manifest.json      数据集元信息
migrations/0001_init.sql D1 表结构
scripts/build-data.js   从 linuxdo-85w.txt 构建数据
scripts/export-d1-sql.js 导出 D1 seed SQL
scripts/test-photos-api.js Node API 回归测试
scripts/test-worker-api.js Worker API 回归测试
wrangler.toml           Cloudflare Workers 配置
```

## 本地运行 Node 版本

```bash
npm install
npm run build:data
npm start
```

默认监听 `127.0.0.1:26785`，可通过 `PORT` 覆盖：

```bash
PORT=3000 npm start
```

## 检查

```bash
npm run check
npm run test:photos
npm run test:worker
```

## Cloudflare Workers + D1

Workers 版本使用 `public/` 作为 Static Assets，`src/worker.js` 提供 `/api/*`，D1 保存相册、详情和点赞数据。

### 生成 D1 数据

测试数据导出：

```bash
npm run export:d1 -- --limit 200 --out data/d1-seed-test.sql
```

完整数据导出：

```bash
npm run export:d1 -- --out data/d1-seed.sql
```

默认导出的 SQL 兼容 D1 remote import，不包含 `BEGIN TRANSACTION`。如果只用于本地 SQLite 调试，可以追加 `--transaction`。

### 部署流程

创建 D1：

```bash
npx wrangler d1 create xrw-album-test
```

把返回的 `database_id` 写入 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "xrw-album-test"
database_id = "..."
```

导入表结构和测试数据：

```bash
npx wrangler d1 execute xrw-album-test --file migrations/0001_init.sql --remote
npx wrangler d1 execute xrw-album-test --file data/d1-seed-test.sql --remote
```

部署 Worker：

```bash
npx wrangler deploy
```

### 本地 Worker 验证

```bash
npm run export:d1 -- --limit 20 --out data/d1-seed-test.sql
npx wrangler d1 execute xrw-album-test --local --file migrations/0001_init.sql
npx wrangler d1 execute xrw-album-test --local --file data/d1-seed-test.sql
npx wrangler dev --local --ip 127.0.0.1 --port 8787
```

打开 `http://127.0.0.1:8787`。

## 已验证

- `npm run check`
- `npm run test:photos`
- `npm run test:worker`
- `npx wrangler deploy --dry-run`
- Workers 测试部署：`https://xrw-album-workers.cfmxy123.workers.dev`

## 注意

- `data/d1-*.sql` 是生成文件，不入库。
- `data/likes.json` 是 Node 版本本地点赞文件，不入库。
- Workers 测试预览当前是样本 D1 数据；完整数据需要执行完整导出和远端 D1 导入。

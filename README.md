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
```

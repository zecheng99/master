# 这一年 · 365 天心愿手账

前端发布到现有 `master` 仓库的 GitHub Pages 子目录 `/master/this-year/`，独立 Cloudflare Worker + D1 + 私有 R2 保存记录和照片。无需 ChatGPT 账户。界面采用与 Spendex 一致的蓝紫主色、浅灰背景、白色圆角卡片与系统字体。支持 11 条心愿、次数进度、完成日期、照片与心得。

## 使用

首次打开，在「云同步与备份」中填写服务地址和专用同步密钥。手机、电脑使用相同密钥，读取同一本手账。密钥只保存在设备的 localStorage，绝不内置到网页或提交 GitHub。持有密钥者可读写整本手账；不提供端到端加密。照片通过带鉴权的接口读取，R2 不开放公开访问。

iPhone：Safari → 分享 → 添加到主屏幕。Android：Chrome 菜单 → 添加到主屏幕 / 安装应用。

日期固定为 2026-11-08 至 2027-11-07，按 Asia/Singapore 自然日计算。首日剩余 365 天，末日 1 天，次日归零；结束后仍可编辑记录。

首页展示倒计时、整体进度、最多 7 项置顶心愿和“进行中”次数项目；“全部心愿”页按旅行与户外、学习与成长、运动与健康、日常生活分组，保留完成状态筛选。创建或编辑时可以调整分类。

普通心愿手动完成；次数目标从第 1 次开始自动进入“进行中”，达标后自动完成，减少次数可撤销完成。开始次数目标或完成心愿会自动取消置顶，释放位置；回到 0 次或撤销完成不会自动重新置顶。正在进行中或已完成的心愿不占用置顶名额，也不能重复置顶。服务端原子校验最多 7 项，防止多设备并发超过上限。

每条心得最多 9 张照片，支持 JPEG / PNG / WebP；浏览器将照片压缩为最大边 2000px 的 JPEG，压缩后每张最多 5 MB。服务端同时校验大小、类型和文件头。

## 更新、离线和备份

Service Worker 对本应用静态资源采用 network-first。在线刷新或完全关闭后重开获取新版；已打开的页面不强制刷新，不清理配置或记录，不需要卸载 PWA。缓存只清理 `thisyear-` 前缀的旧版本，不处理其他 App 的缓存，不缓存 API、鉴权或写请求。

设备保存最近一次成功读取的数据快照；照片通过鉴权读取后另外保存在 IndexedDB。断网时可以打开缓存的页面、查看快照和曾在本设备打开的照片。第一版离线为只读，联网后自动重新读取。浏览器可能回收本地缓存，云端为正式记录。

「导出完整备份」保存包含心愿、心得及全部照片的 JSON，不含密钥。支持系统文件分享或下载。置顶和分类也包含在备份中，旧版备份没有这些字段时仍可导入；若合并后置顶超过 7 项，导入前提示先取消部分置顶。照片原始总量最多 60 MB，导入文件最多 100 MB。未缓存且离线不可读取的照片会阻止完整导出，不会生成缺图却声称完整的备份。

导入先验证结构，确认后按记录 ID 合并；已存在的记录保持不变。导入中断可以重复执行，稳定 ID 避免重复创建。新导入的心愿按备份顺序追加到当前列表，现有排序不改变。独立新建但标题相同的两个心愿仍视为不同记录。

## 开发和部署

源代码在 `src/`，采用已有 React 交互组件和 Vite 本地打包，生产页面无需 CDN。构建后的 `index.html`、`assets/`、图标、manifest 与 Service Worker 一并提交，GitHub Pages 无需服务器或构建步骤。

```sh
npm ci
npm run check
npm test
npm run build
```

构建会将输出写到忽略的 `.build/` 再复制发布文件到当前目录，并按资源内容自动生成新的 Service Worker 缓存版本。

Worker 首次部署：

1. 在自己的 Cloudflare 账户启用 R2。
2. 复制 `sync-worker/wrangler.example.toml` 为 `wrangler.toml`。
3. 使用 Wrangler 创建独立 D1 数据库和标准存储 R2 桶，将 ID 填入本地配置。
4. 在 `sync-worker/` 执行 `wrangler d1 execute this-year --remote --file schema.sql`，仅首次创建基础结构；然后执行 `wrangler d1 migrations apply this-year --remote` 应用增量迁移。已有数据库只执行 migrations apply，不要重跑 schema.sql。
5. 执行 `wrangler deploy`。
6. 生成至少 24 字符的随机密钥，通过 `wrangler secret put SYNC_KEY` 保存到 Worker；单独保管密钥，不提交仓库。
7. 如改了默认 Worker 地址，更新 `src/cloud.ts` 后重新构建；如修改 GitHub 域名，更新 Worker 的 `ALLOWED_ORIGINS` 后部署。
8. 提交本 App 的源代码和构建结果到现有 master/main，等待 GitHub Pages 完成。

实际的 `wrangler.toml`、`.dev.vars`、个人数据迁移文件、node_modules、`.wrangler` 和 `.build` 都已忽略，不能强行加入公开仓库。前端只含 Worker 公共接口地址，不含密钥。Worker schema 变更须编写后续迁移，不能对已有数据库重跑创建脚本。

## 验证

`npm test` 包含固定时区的日期边界，以及真实 SQLite 和内存 R2 的 Worker 测试：旧数据升级、分类、并发置顶上限、置顶状态变化、认证、CORS、种子幂等、新增重试去重、次数和完成日期、排序、心得编辑、照片格式和 9 张限制、数据归属和关联删除。

浏览器测试通过 web-access CDP Proxy 运行，只能针对可丢弃的本地测试数据库。先对本地 D1 应用 schema.sql（仅新库）和 `wrangler d1 migrations apply this-year --local`，再启动 Wrangler dev（127.0.0.1:8787）和映射 `/master/` 到仓库根目录的静态服务（127.0.0.1:8000），并在 `.dev.vars` 设置本地密钥，运行 `python3 tests/browser.py`。该测试验证双 Tab、四分类、7 项置顶上限、开始后自动进入“进行中”、表单、真实照片压缩上传、失败保留草稿、重试、达标、带分类/置顶/照片的备份恢复及 320/390/430px 手机布局；不会调用生产数据接口。

原 ChatGPT Sites 站点保留作为迁移前副本。新旧站不持续同步，迁移后请使用新地址。

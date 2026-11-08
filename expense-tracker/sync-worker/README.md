# Spendex 云同步

使用独立的 Cloudflare Worker 和 D1 数据库。原来的静态网页继续使用原网址，
不需要迁移手机 PWA 的浏览器存储。日常账单、旅行信息、旅行中的每笔开销及
每周餐饮预算都会同步。

## 部署

在此目录执行，需要 Node.js 与可用的 Cloudflare 登录：

```sh
npx wrangler login
npx wrangler d1 create spendex
```

将创建结果里的数据库 ID 填入 `wrangler.toml` 的 `database_id`，再执行：

```sh
npx wrangler d1 execute spendex --remote --file=schema.sql
openssl rand -hex 32
npx wrangler secret put SYNC_KEY
npx wrangler deploy
```

将生成的随机密钥输入 `secret put` 提示并保存到密码管理器。不要把密钥提交到
仓库，也不要在网页中填写 Cloudflare 账号密码或 API Token。

还需要通过原有静态站点发布流程发布本次前端改动，保持原域名和路径，避免
现有手机 PWA 因来源变化无法读取本地记录。此修改未自动执行 Git 提交或推送。

服务器默认允许 `https://shelvee11.github.io` 和本地 8000 端口跨域访问；若网页
换了域名，请修改 `src/index.js` 的 `ALLOWED_ORIGINS`，或通过 Wrangler 的
`vars.ALLOWED_ORIGINS` 设置逗号分隔的来源列表，再部署。

## 连接设备

1. 更新并打开原网址的网页版和手机 PWA，点击右上角「云同步」。
2. 两边填写同一个 Worker 根地址（例如 `https://spendex-sync.example.workers.dev`）
   和同一个专用同步密钥，点击「保存并同步」。
3. 两边状态显示「已同步」后即可互相查看数据。首次连接前可用原有 CSV 导出功能
   备份重要账单。

修改后约 1.2 秒自动同步，回到应用、恢复网络时也会同步；应用在前台时每 30 秒
检查一次。关闭应用时不会持续后台同步，离线数据会在下次打开并联网时补传。
「断开云同步」仅删除本机连接配置，保留本机与云端数据。

## 合并规则与限制

- 每笔日常账单、旅行资料、每笔旅行开销分别合并；同一项冲突使用最后修改版本。
  修改顺序由设备时间和单调递增时间戳决定，建议设备启用自动校时。
- 删除保留标记，其他离线设备重新上线不会复活未修改的旧记录。
- 新连接设备的既有数据只用于补充云端缺失项目，不覆盖已有云端修改或删除。
- 首次合并按记录 ID 识别，同一开销若曾在两台设备分别手动录入，仍是两笔记录。
- 云端采用 revision 条件更新避免同时上传互相覆盖；冲突会重新读取并合并。
- 同步密钥保存在该设备的 localStorage；持有密钥的人可以读写这份账本。
  云端存储不提供端到端加密。
- 当前为个人账本整包同步，单次上限 4 MiB，包含删除标记。超出时保留本地修改并
  显示服务器错误；大量长期数据需要后续改成分页增量同步。
- 旅行表单有未提交输入时，后台同步会先更新存储，待下次切换页面时刷新显示。

## 验证

在 `expense-tracker/` 目录执行：

```sh
node --test tests/sync.test.mjs
```

测试需要支持 `node:sqlite` 的 Node.js，覆盖两设备同时上传、离线新增与删除、旅行
账单合并、预算迁移、上传期间修改、鉴权、revision 冲突和 Service Worker 缓存隔离。

部署后仍需实机验收：在电脑新增一笔，手机打开后检查；手机断网新增后恢复网络，
再检查电脑；删除一笔后确认两端均消失。

官方参考：[D1 Worker 绑定](https://developers.cloudflare.com/d1/best-practices/remote-development/)、
[Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。

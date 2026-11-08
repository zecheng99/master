# Spendex 云同步

使用独立的 Cloudflare Worker 和 D1 数据库。原来的静态网页继续使用原网址，
不需要迁移手机 PWA 的浏览器存储。日常账单、旅行信息、旅行中的每笔开销及
每周餐饮预算都会同步。

旅行页支持多个同时进行的行程，每个行程分别记住上次选择的币种。已有旅行账单
没有币种字段时按人民币处理；每个行程首次选择尚未填写汇率的外币时提示输入，
填写后实时显示人民币累计支出。记账页和汇总页均可修改汇率，修改后重算整个行程。
币种、上次选择及行程汇率均随账单同步。取消汇率输入时保留账单和当前草稿，
没有汇率的外币仍标为待折算，避免混合金额被误计为人民币。
旅行 CSV 包含原币、汇率与人民币折算金额，仍兼容以前的人民币 CSV。

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

当前前端地址为 `https://zecheng99.github.io/master/expense-tracker/`。
服务器默认允许 `https://zecheng99.github.io`、旧地址 `https://shelvee11.github.io`
和本地 8000 端口跨域访问；若网页
换了域名，请修改 `src/index.js` 的 `ALLOWED_ORIGINS`，或通过 Wrangler 的
`vars.ALLOWED_ORIGINS` 设置逗号分隔的来源列表，再部署。

## 连接设备

1. 更新并打开原网址的网页版和手机 PWA，点击右上角「云同步」。
2. 两边填写同一个专用同步密钥，点击「保存并同步」。云端地址已经内置为
   `https://spendex-sync.zechengyu90.workers.dev`，无需手动填写。
3. 两边状态显示「已同步」后即可互相查看数据。首次连接前可用原有 CSV 导出功能
   备份重要账单。

修改后约 1.2 秒自动同步，回到应用、恢复网络时也会同步；应用在前台时每 30 秒
检查一次。关闭应用时不会持续后台同步，离线数据会在下次打开并联网时补传。
「断开云同步」仅删除本机连接配置，保留本机与云端数据。
已有设备保存的连接配置和密钥继续使用；未填写密钥或断开后不会请求同步接口。
以后更换默认 Worker 地址时修改 `cloud-sync.js` 的 `DEFAULT_SYNC_URL` 并发布前端。

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
- 后台同步刷新旅行记录时保留当前表单输入；不同旅行的草稿分别暂存在当前页面内，
  切换行程或标签不会丢失。未提交草稿不参与同步，刷新或关闭页面会清除草稿。

## 验证

在 `expense-tracker/` 目录执行：

```sh
node --test tests/*.test.mjs
```

测试需要支持 `node:sqlite` 的 Node.js，覆盖两设备同时上传、离线新增与删除、旅行
账单合并、预算迁移、上传期间修改、鉴权、revision 冲突和 Service Worker 缓存隔离。
还覆盖混合币种统计、行程汇率重算、多行程同步、旧数据和 CSV 的兼容。

浏览器回归脚本为 `tests/travel.browser.mjs`，使用 Playwright 和本机 Chrome。
在另一个终端从 `expense-tracker/` 启动 `python3 -m http.server 8000`，然后执行：

```sh
npm install --prefix /tmp/spendex-browser-check --no-save playwright
PLAYWRIGHT_MODULE=/tmp/spendex-browser-check/node_modules/playwright/index.mjs node tests/travel.browser.mjs
PLAYWRIGHT_MODULE=/tmp/spendex-browser-check/node_modules/playwright/index.mjs node tests/sync.browser.mjs
```

默认 Chrome 路径适用于 macOS；可用 `CHROME_EXECUTABLE` 指定其他 Chrome 路径，
`TEST_BASE_URL` 指定本地测试网址。脚本在隔离浏览器环境中操作虚构账单，覆盖完整
多行程流程、草稿保留、汇率弹窗、手机布局和离线重开，不使用线上密钥或账单。
同步界面脚本验证只填密钥、旧配置兼容和断开后停止请求，使用拦截的测试接口。

部署后仍需实机验收：在电脑新增一笔，手机打开后检查；手机断网新增后恢复网络，
再检查电脑；删除一笔后确认两端均消失。

官方参考：[D1 Worker 绑定](https://developers.cloudflare.com/d1/best-practices/remote-development/)、
[Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。

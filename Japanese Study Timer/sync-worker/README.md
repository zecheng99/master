# 跡 云同步服务

手机上记的学习时长自动传到云端，电脑上打开同一个网址就能看到，中间没有手动步骤。
服务端是一个 Cloudflare Worker + 一个 D1 数据库，个人用量在免费额度内（Worker 每天
10 万次请求、D1 每天 500 万行读），一天记几次连零头都碰不到。

结构照搬 `aside/sync-worker/`，两套是各自独立的 Worker 和数据库，互不影响。

## 已部署（2026-08-16）

|               |                                                              |
| ------------- | ------------------------------------------------------------ |
| Worker 地址     | `https://jp-study-sync.zechengyu90.workers.dev`              |
| Cloudflare 账号 | <zechengyu90@gmail.com>                                      |
| D1 数据库        | `jpstudy`，id `3fe769c7-eb21-454f-9d06-46a2d90777d0`（区域 APAC） |
| 同步密钥          | **不写在这里**。部署时生成，存在你的密码管理器里                    |

改完代码重新上线：`npx wrangler deploy`。下面的部署步骤是留给换账号或重建时用的。

> **国内直连不通，必须走代理。** 2026-08-16 在本机实测，`*.workers.dev` 被卡在两层：
>
> 1. **DNS 被污染**——系统解析器把 `jp-study-sync.zechengyu90.workers.dev` 解析成
>    `103.97.3.19`、`aside-sync...` 解析成 `108.160.167.147`，都是无关 IP。真实
>    地址是 Cloudflare 的 `104.21.90.244` / `172.67.162.210`（两个 Worker 共用）。
> 2. **SNI 被重置**——就算 `--resolve` 指定真实 IP 绕过 DNS，TCP 443 能建连，但
>    Client Hello 一带上 `*.workers.dev` 的 SNI 就 `Connection reset by peer`。
>
> 所以换 DNS（DoH、改 8.8.8.8）解决不了，只有走代理。aside 那套是同一个域名后缀、
> 同一批真实 IP，情况完全一样——平时没察觉是因为浏览器和手机都挂着代理。
>
> 手机上不开代理同步不上的话，是这个原因，不是密钥或代码的问题——设置页会显示
> 「上次失败：连不上服务器」，本地记录不受影响，等有网络时会自动补推。

## 部署（一次性，约 10 分钟）

以下命令都在 `sync-worker/` 目录里跑。

```bash
cd ~/shelvee_master/"Japanese Study Timer"/sync-worker

# 1. 登录 Cloudflare（已经登录过就跳过，aside 那套用的是同一个账号）
npx wrangler login

# 2. 建数据库。输出里有一行 database_id = "xxxx-xxxx-..."，复制它
npx wrangler d1 create jpstudy

# 3. 把上一步的 id 填进 wrangler.toml，替换掉 PASTE_DATABASE_ID_HERE

# 4. 建表（--remote 是线上库，不加就只建在本地）
npx wrangler d1 execute jpstudy --remote --file=schema.sql

# 5. 生成一个同步密钥，复制它
openssl rand -base64 24

# 6. 设进 Worker（会提示粘贴，粘上一步生成的密钥）
npx wrangler secret put SYNC_KEY

# 7. 部署。输出末尾是网址：https://jp-study-sync.<你的账号>.workers.dev
npx wrangler deploy
```

改完代码重新上线：`npx wrangler deploy`。

## 开启同步

在手机和电脑上分别打开跡 → 设置 → 「云同步」。服务地址已预填，只需填写各设备共用的专用同步密钥：

- **Worker 地址**：第 7 步输出的那个 `https://...workers.dev`
- **同步密钥**：第 5 步生成的那串

两台设备填的密钥必须一样。填完点「保存并同步」，几秒后手机上的记录就会出现在电脑上。

之后不用再管：存一条 → 2.5 秒后自动上传；切回 App、恢复网络、重新打开页面 → 自动拉一次。

## 有几件事要知道

**进行中的计时不同步。** 只有停表存下来的记录才会同步。计时中的那段每次暂停/继续都在
变，两台设备抢同一段计时的话，谁赢都可能吞掉一段正在计的时间——所以它留在本机。
在手机上开始计时，电脑上不会看到「学习中」，停表存下之后才出现。

**目标设置是「最后写入的赢」。** 每日目标、每周目标整体存一行，哪台设备后改的算哪台的。
但第一次同步的设备例外：它带上来的设置只当种子用，云端已经有值就不覆盖（否则新设备
一上来就把设好的目标冲回默认的 30 分钟 / 6 天）。

**换了域名要改白名单。** `src/index.js` 顶部的 `ALLOWED_ORIGINS` 写死了
`https://zecheng99.github.io` 和兼容的旧域名 `https://shelvee11.github.io`。换托管地址的话要加进去再重新 `npx wrangler deploy`，
否则浏览器会拦跨域请求。

**「清除所有数据」只清本机。** 云端不受影响，下次同步还会拉回来。真想清云端得直接
操作数据库：`npx wrangler d1 execute jpstudy --remote --command "DELETE FROM sessions"`。

**密钥存在浏览器 localStorage 里。** 这是个人自用工具的取舍——没有账号体系，一串密钥
就是全部的门禁。别把网址和密钥一起发给别人。想换密钥就重跑第 5、6 步，然后在每台
设备上重新填一次。

## 同步是怎么工作的

```
  手机 ──┐                        ┌── sessions 表：一条记录一行
         ├──▶ POST /sync ──▶ D1 ──┤    updated = 服务器时间（增量游标）
  网页 ──┘   一次往返同时          │    deleted = 墓碑，删除必须留痕
             推本地改动 +          └── meta 表：目标设置存一行
             拉别人的改动
```

客户端不给每条记录加 `updated` 字段，而是存一份 `id → 内容 hash` 的快照，同步时和
当前数据比一遍，算出哪几条改过、哪几条被删了。好处是前端所有写入都走同一个
`saveData()`，加同步这件事没有侵入到原有的任何一条业务逻辑里。

删除靠墓碑：直接删行的话，另一台设备下次同步会把它当成「本地有、云端没有」的新记录
推回来，删掉的东西会复活。

## 本地调试

```bash
npx wrangler d1 execute jpstudy --local --file=schema.sql   # 建本地表
npx wrangler dev --port 8788                                # 起本地服务
```

本地密钥写在 `.dev.vars`（已 gitignore）。前端的 CORS 白名单里留了
`http://localhost:8000`，所以本地可以 `python3 -m http.server 8000` 起前端联调，
在设置页把 Worker 地址填成 `http://127.0.0.1:8788`。

## 验证

在仓库根目录执行 `node --test "Japanese Study Timer/tests/"*.mjs`，使用内存 SQLite 验证双设备合并、编辑和删除、离线补传、目标同步、错误重试、配置切换、鉴权和 CORS，并检查 Service Worker 在线更新、离线回退与缓存隔离。

启动 web-access CDP Proxy 后运行 `python3 "Japanese Study Timer/tests/browser.py"`。它会启动临时本地静态服务，在独立测试页面中模拟同步响应，验证设置、密钥隐藏、历史记录上传、远端合并、离线补传和本地计时保留；不会访问生产同步 API。

密钥不会预填或写入公开源码。服务端继续使用已有 Cloudflare Secret，浏览器只在本机保存用户配置。更新无需卸载应用，也不清空已有学习记录。

# 云同步配置面板

`cloud-sync-ui.js` 是四个应用共用的独立 UI 模块，样式参照「这一年」。统一标题、地址与密钥输入框、显示/复制、连接状态、保存按钮、备份区、手机尺寸和键盘焦点。所有样式使用 `cs-` 前缀，面板样式不依赖宿主应用的 CSS。配置值写入 input.value，不拼进 HTML。

该模块只负责展示、URL/密钥格式校验和操作状态，不存储密钥、不发起同步请求。应用通过 `getConfig` 和 `onSave` 接入自己的存储与协议，保留已有 Worker、数据库和本地数据。以后新增应用也可直接复用。

原生 JS 应用加载 `../shared/cloud-sync-ui.js` 后：

```js
const panel = CloudSyncUI.mount(document.body, {
  dialog: true,
  getConfig: () => ({ url: getServiceAddress(), key: getSavedKey() }),
  onSave: config => connectAndSync(config),
  description: '手机和电脑填写相同的同步地址和专用密钥，即可同步记录。',
  backup: {
    format: 'JSON', accept: '.json,application/json',
    export: () => exportBackup(), import: event => importBackup(event)
  }
});
// 入口点击时调用 panel.open()；后台同步调用 panel.setStatus(message)。
```

可选 `onDisconnect` 保留本地与云端数据并清除连接。可选 `ids` 用于宿主适配。`dialog:false` 将同一表单嵌入既有弹窗，「这一年」通过 React `SyncSettings` 封装使用，源码构建进自己的 Vite bundle。

面板关闭或销毁时隐藏/清空密钥，复制只通过用户点按触发。连接中防止重复提交，独立弹窗支持 Escape、Tab 循环和关闭后焦点恢复。配置输入在后台刷新时保留。

原生应用的 Service Worker 必须把共享 JS 的路径加入离线静态资源清单，并更新各自缓存版本；离线回退只查询本应用缓存。React 应用构建会将共享模块打包并更新资源哈希。任何应用更新都不清理 localStorage 或其他应用缓存。

验证：`node --test shared/tests/*.mjs`；四个应用自身的同步和浏览器测试覆盖集成、连接配置、密钥隐藏/复制、备份、离线与手机布局。

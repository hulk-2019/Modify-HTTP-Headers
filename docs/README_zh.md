# Modify HTTP Headers

[English](../README.md) | 简体中文

修改 HTTP 请求头的浏览器插件，支持 **Chrome** 和 **Firefox**（Manifest V3）。

## 示例截图

![示例 1](../public/example-1.png)

![示例 2](../public/example-2.png)

![示例 3](../public/example-3.png)

## 功能

- 填写 key-value 键值对，修改 HTTP **请求头 / 响应头**
- 支持三种操作：`set`（有则覆盖，无则新增）、`append`（追加）、`remove`（删除，无需填 value）
- 每条规则可配置 URL 匹配条件（支持通配符，如 `*://api.example.com/*`），留空则对所有请求生效
- 每条规则带开关；**全局总开关**一键暂停所有规则
- 工具栏图标角标显示状态：数字 = 生效规则数，`OFF` = 总开关关闭，`ERR` = 规则同步失败（弹窗内显示错误原因）
- **多配置档（Profile）**：如「开发环境」「测试环境」各存一组规则，一键切换
- **完整管理页**：规则搜索、排序（上移/下移）、批量启用/停用/删除
- **导入 / 导出**：JSON 格式，便于团队共享与迁移
- **命中统计**：查看各规则最近 5 分钟的命中次数（仅 Chrome）
- **中英文界面**：初始语言按浏览器语言检测（中国大陆 / 香港 / 澳门 / 台湾默认中文，其他默认英文），弹窗或管理页右上角均可手动切换（popup / 管理页 / 帮助页统一生效）
- **内置帮助文档**：弹窗点 `?` 或管理页点「帮助」，分模块解释各功能的用法与常见问题
- 启用但未填写头名称的规则会以红框提示

底层用 `declarativeNetRequest` 动态规则；URL 匹配使用 DNR 的 [`urlFilter` 语法](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest#filter_pattern_syntax)。

## 打包

分浏览器打包（根目录 `manifest.json` 即 Chrome 格式，Firefox 专用字段在打包时注入）：

```bash
npm run build           # 同时打包 chrome 和 firefox
npm run build:chrome    # 仅 chrome
npm run build:firefox   # 仅 firefox
```

产物在 `dist/` 下：

- `dist/chrome/`、`dist/firefox/`：可直接在浏览器加载的解压目录
- `chrome-v*.zip`、`firefox-v*.zip`：分发用压缩包

## 安装

### Chrome / Edge

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择**项目根目录**（或 `dist/chrome/`）

### Firefox（128+）

Firefox 的 MV3 后台脚本格式与 Chrome 不同（`background.scripts`），需先构建：

1. 运行 `npm run build:firefox`
2. 打开 `about:debugging#/runtime/this-firefox`
3. 点击「临时载入附加组件」，选择 `dist/firefox/manifest.json`

> 临时载入的插件重启后消失，需重新载入；正式分发需打包为 `.xpi` 并签名。

## 使用

1. 点击工具栏图标打开弹窗
2. 「+ 新增规则」，选择目标（请求头 / 响应头）和操作（set / append / remove）
3. 填写头名称(key)和值(value)（remove 操作无需填值）
4. 可选填写 URL 匹配（如 `*://api.example.com/*`），留空对所有请求生效
5. 用开关启用 / 停用，点 `✕` 删除；右上角总开关可一键暂停所有规则
6. 弹窗顶部下拉框切换配置档；点「管理」打开完整管理页（配置档管理、搜索、批量操作、导入导出、命中统计）

改动即时保存并生效。

## 注意事项

- 部分受浏览器保护的请求头可能无法修改。
- Chrome 中 `append` 操作仅支持部分请求头（如 `Accept`、`Accept-Language`、`Cookie` 等），响应头无此限制。
- 命中统计依赖 Chrome 的 `getMatchedRules` API，Firefox 暂不支持（管理页会给出提示）。
- Firefox 需 128 及以上版本。

// browser-polyfill.js
// 一层薄薄的兼容垫片：Firefox 用 `browser`（返回 Promise），
// Chrome 用 `chrome`。MV3 下 Chrome 的 storage / declarativeNetRequest
// 大多也支持 Promise，这里统一暴露成 `browserAPI`。
const browserAPI = (typeof browser !== "undefined") ? browser : chrome;

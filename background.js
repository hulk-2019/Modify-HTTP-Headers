// background.js
// 后台脚本：把用户配置（当前启用配置档里的规则）同步成
// declarativeNetRequest 的动态规则，并维护工具栏角标与同步状态。
//
// Chrome：以 service worker 运行，只加载本文件，需 importScripts 引入依赖。
// Firefox：以 background scripts 运行，manifest 已按顺序加载
//          browser-polyfill.js / common.js，且其环境没有 importScripts。
if (typeof importScripts === "function") {
  importScripts("browser-polyfill.js", "common.js");
}

// 支持的资源类型：几乎覆盖所有网络请求
const RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "other"
];

// —— URL 匹配 ——
// 用户按 match pattern 的习惯书写（*://api.example.com/*），而
// declarativeNetRequest 的 urlFilter 是子串/通配语法，要求 host 后紧跟 "/"。
// 于是目标地址带显式端口时（http://localhost:8080/x），host 后面实际是
// ":8080/"，整条规则会静默不匹配。所以写成 scheme://host/path 形式的一律
// 翻译成 regexFilter，并允许 host 后出现可选端口；其余写法（纯子串、
// urlFilter 原生语法）保持原来的语义不变。
const REGEX_META = /[.*+?^${}()|[\]\\]/g;

// 把带 * 的片段转成正则，* 的匹配范围由 anyChars 决定
function globToRegex(segment, anyChars) {
  return segment
    .split("*")
    .map((part) => part.replace(REGEX_META, "\\$&"))
    .join(anyChars);
}

const NOT_HOST = "[^/:?#]*"; // host 内的通配不允许跨过端口、路径、查询串
const NOT_SCHEME = "[^:/?#]+";

function matchPatternToRegex(pattern) {
  const rest = pattern.slice(pattern.indexOf("://") + 3);
  const scheme = pattern.slice(0, pattern.indexOf("://"));
  const slash = rest.indexOf("/");
  const host = slash === -1 ? rest : rest.slice(0, slash);
  // 没写路径等价于 /*，匹配该 host 下的所有地址
  const pathPart = slash === -1 ? "/*" : rest.slice(slash);

  const schemeRe =
    scheme === "*" || scheme === "" ? NOT_SCHEME : globToRegex(scheme, NOT_HOST);
  // "*.example.com" 按 match pattern 的习惯理解为「example.com 及其子域」
  const hostRe = host.startsWith("*.")
    ? `(?:${NOT_HOST}\\.)?` + globToRegex(host.slice(2), NOT_HOST)
    : globToRegex(host, NOT_HOST);
  // 用户一般不写端口，但真实地址里可能有
  const portRe = /:(\d+|\*)$/.test(host) ? "" : "(?::\\d+)?";

  return `^${schemeRe}://${hostRe}${portRe}${globToRegex(pathPart, ".*")}$`;
}

function urlCondition(urlPattern) {
  // 留空则匹配所有请求
  if (!urlPattern) return { urlFilter: "*" };
  if (!urlPattern.includes("://")) return { urlFilter: urlPattern };
  return { regexFilter: matchPatternToRegex(urlPattern) };
}

// 把一条用户规则转换成 declarativeNetRequest 请求头 set 规则。
function toDNRRule(rule) {
  const urlPattern =
    typeof rule.urlPattern === "string" ? rule.urlPattern.trim() : "";

  return {
    id: rule.numId,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: rule.headerName,
          operation: "set",
          value: rule.headerValue
        }
      ]
    },
    condition: {
      ...urlCondition(urlPattern),
      resourceTypes: RESOURCE_TYPES
    }
  };
}

// 工具栏角标：数字 = 生效规则数；OFF = 总开关关闭；ERR = 同步失败
async function setBadge(text, color) {
  try {
    await browserAPI.action.setBadgeText({ text });
    if (color) {
      await browserAPI.action.setBadgeBackgroundColor({ color });
    }
  } catch (_) {
    // 个别环境不支持角标 API，忽略即可
  }
}

// 同步结果写入存储，供 popup / options 展示
async function writeSyncStatus(status) {
  await browserAPI.storage.local.set({
    [SYNC_STATUS_KEY]: { ...status, time: Date.now() }
  });
}

// 读取配置并全量刷新动态规则
async function syncRules() {
  const config = await loadConfig();

  // 先拿到当前所有动态规则的 id，全部移除后再添加新的，做到幂等
  const existing = await browserAPI.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);

  // 总开关关闭：清空动态规则但保留用户配置
  if (!config.globalEnabled) {
    await browserAPI.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
    await setBadge("OFF", "#9ca3af");
    await writeSyncStatus({ ok: true, enabledCount: 0, globalEnabled: false });
    return;
  }

  const profile = getActiveProfile(config);
  const rules = profile ? profile.rules : [];

  // 只下发「启用」且字段完整的规则
  const enabledRules = rules.filter(
    (r) => r.enabled && r.headerName && r.headerName.trim()
  );
  const newDNRRules = enabledRules.map(toDNRRule);

  try {
    await browserAPI.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules: newDNRRules
    });
    await setBadge(newDNRRules.length ? String(newDNRRules.length) : "", "#2563eb");
    await writeSyncStatus({
      ok: true,
      enabledCount: newDNRRules.length,
      globalEnabled: true
    });
  } catch (err) {
    // updateDynamicRules 是原子操作：整批被拒绝时（如受保护的头、非法正则），
    // 先清掉旧规则避免陈旧规则继续生效，再把错误上报给 UI。
    try {
      await browserAPI.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
    } catch (_) {
      /* 清理失败无需处理 */
    }
    await setBadge("ERR", "#ef4444");
    await writeSyncStatus({
      ok: false,
      error: String((err && err.message) || err),
      globalEnabled: true
    });
  }
}

// 配置变化时自动同步（注意：写 syncStatus 不会触发，避免自循环）
browserAPI.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[CONFIG_KEY] || changes[LEGACY_STORAGE_KEY])) {
    syncRules();
  }
});

// 安装/启动时同步一次
browserAPI.runtime.onInstalled.addListener(() => syncRules());
browserAPI.runtime.onStartup && browserAPI.runtime.onStartup.addListener(() => syncRules());

// Service Worker 被唤醒时也同步一次，避免规则丢失
syncRules();

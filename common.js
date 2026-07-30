// common.js
// popup / options / background 共用的存储模型与工具函数。
// 依赖 browser-polyfill.js 先行加载（暴露全局 browserAPI）。
//
// v2 存储结构（appConfig）：
//   {
//     globalEnabled: boolean,          // 全局总开关
//     activeProfileId: string,         // 当前启用的配置档
//     profiles: [{ id, name, rules }]  // 配置档列表
//   }
// 规则字段：{ id, numId, enabled, target, operation, headerName, headerValue, urlPattern }
// v1 老数据（headerRules 数组）会在首次读取时自动迁移进默认配置档。

const CONFIG_KEY = "appConfig";
const LEGACY_STORAGE_KEY = "headerRules";
const SYNC_STATUS_KEY = "syncStatus";

// —— i18n ——
// 语言可由用户手动切换（config.language："en" | "zh"），运行时从 _locales
// 加载对应消息文件（browserAPI.i18n.getMessage 无法在运行时切换语言）。
// 初始默认值按浏览器界面语言检测，见 detectDefaultLanguage()。
const LANG_LOCALE_DIR = { en: "en", zh: "zh_CN" };

// 初始语言：中国大陆 / 香港 / 澳门 / 台湾默认中文，其他默认英文。
// 裸 "zh"（未带地区的中文界面）也视为中文。
function detectDefaultLanguage() {
  const ui = (browserAPI.i18n.getUILanguage() || "")
    .toLowerCase()
    .replace("_", "-");
  const zhLocales = ["zh", "zh-cn", "zh-hk", "zh-mo", "zh-tw"];
  return zhLocales.includes(ui) ? "zh" : "en";
}

let i18nMessages = null;

async function initI18n(lang) {
  const dir = LANG_LOCALE_DIR[lang] || LANG_LOCALE_DIR.en;
  try {
    const res = await fetch(
      browserAPI.runtime.getURL(`_locales/${dir}/messages.json`)
    );
    i18nMessages = await res.json();
  } catch (_) {
    i18nMessages = null; // 加载失败时 t() 回退到浏览器 i18n
  }
}

function t(key, substitutions) {
  const subs = substitutions == null ? [] : [].concat(substitutions);

  const entry = i18nMessages && i18nMessages[key];
  if (entry) {
    let msg = entry.message || "";
    // 展开 $name$ 占位符（content 形如 "$1"，指向第 N 个替换参数）
    if (entry.placeholders) {
      for (const [name, ph] of Object.entries(entry.placeholders)) {
        const idx = parseInt(String(ph.content || "").replace("$", ""), 10);
        const val = subs[idx - 1] != null ? String(subs[idx - 1]) : "";
        msg = msg.split(`$${name}$`).join(val);
      }
    }
    return msg;
  }

  const fallback = browserAPI.i18n.getMessage(key, substitutions);
  return fallback || key;
}

// 把页面里带 data-i18n / data-i18n-placeholder / data-i18n-title
// 标记的元素填充为当前语言文案（background 无 document，直接跳过）
function applyI18n(root) {
  if (typeof document === "undefined") return;
  const scope = root || document;
  scope.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
}

// —— id 生成 ——
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// declarativeNetRequest 规则 id 必须是正整数且唯一（同一配置档内）
function nextNumId(rules) {
  return (
    rules.reduce(
      (max, r) => (Number.isInteger(r.numId) && r.numId > max ? r.numId : max),
      0
    ) + 1
  );
}

// 为缺少 numId 的规则补齐稳定数字 id，返回是否有改动
function ensureNumIds(rules) {
  let maxId = rules.reduce(
    (max, r) => (Number.isInteger(r.numId) && r.numId > max ? r.numId : max),
    0
  );
  let changed = false;
  for (const rule of rules) {
    if (!Number.isInteger(rule.numId) || rule.numId <= 0) {
      rule.numId = ++maxId;
      changed = true;
    }
  }
  return changed;
}

// —— 规则 / 配置档构造 ——
function createEmptyRule(rules) {
  return {
    id: genId(),
    numId: nextNumId(rules),
    enabled: true,
    target: "request",
    operation: "set",
    headerName: "",
    headerValue: "",
    urlPattern: ""
  };
}

// 导入外部数据时使用：只保留已知字段并补齐缺省值
function sanitizeRule(raw, rules) {
  const rule = createEmptyRule(rules);
  if (raw && typeof raw === "object") {
    if (typeof raw.headerName === "string") rule.headerName = raw.headerName;
    if (typeof raw.headerValue === "string") rule.headerValue = raw.headerValue;
    if (typeof raw.urlPattern === "string") rule.urlPattern = raw.urlPattern;
    if (raw.target === "response") rule.target = "response";
    if (raw.operation === "append" || raw.operation === "remove") {
      rule.operation = raw.operation;
    }
    rule.enabled = raw.enabled !== false;
  }
  return rule;
}

function createProfile(name) {
  return { id: genId(), name, rules: [] };
}

function defaultConfig() {
  const profile = createProfile(t("profileDefaultName"));
  return {
    globalEnabled: true,
    language: detectDefaultLanguage(),
    activeProfileId: profile.id,
    profiles: [profile]
  };
}

// —— 配置读写 ——
async function loadConfig() {
  const data = await browserAPI.storage.local.get([CONFIG_KEY, LEGACY_STORAGE_KEY]);
  const config = data[CONFIG_KEY];
  if (config && Array.isArray(config.profiles) && config.profiles.length) {
    // 旧版本配置没有 language 字段，按浏览器语言检测默认值
    if (!LANG_LOCALE_DIR[config.language]) {
      config.language = detectDefaultLanguage();
    }
    return config;
  }

  // v1 → v2 迁移：老的规则数组挪进默认配置档。
  // 迁移是确定性的幂等操作，popup 与 background 并发执行也不会丢数据。
  const migrated = defaultConfig();
  const legacyRules = Array.isArray(data[LEGACY_STORAGE_KEY])
    ? data[LEGACY_STORAGE_KEY]
    : [];
  migrated.profiles[0].rules = legacyRules;
  ensureNumIds(migrated.profiles[0].rules);

  await browserAPI.storage.local.set({ [CONFIG_KEY]: migrated });
  await browserAPI.storage.local.remove(LEGACY_STORAGE_KEY);
  return migrated;
}

async function saveConfig(config) {
  await browserAPI.storage.local.set({ [CONFIG_KEY]: config });
}

function getActiveProfile(config) {
  return (
    config.profiles.find((p) => p.id === config.activeProfileId) ||
    config.profiles[0]
  );
}

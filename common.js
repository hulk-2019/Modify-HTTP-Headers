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
// 规则字段：{ id, numId, enabled, headerName, headerValue, urlPattern }
// 所有规则固定修改请求头，并使用 set（覆盖或新增）操作。
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
    rule.enabled = raw.enabled !== false;
    // 沿用原 numId，保持与导出文件一致；
    // 非法或与已接受的规则冲突时退回新分配的值。
    if (
      Number.isInteger(raw.numId) &&
      raw.numId > 0 &&
      !rules.some((r) => r.numId === raw.numId)
    ) {
      rule.numId = raw.numId;
    }
  }
  return rule;
}

function createProfile(name) {
  return { id: genId(), name, rules: [] };
}

// 各语言下「默认配置」的名字集合。自动生成的默认配置档名会存成创建时的语言，
// 用来判断某个配置档名是否是「未被用户改过的默认名」，以便渲染时按当前语言翻译。
const DEFAULT_PROFILE_NAMES = ["默认配置", "Default"];

// 配置档的展示名：若名字仍是任一语言的默认名（用户没改过），
// 则按当前界面语言翻译；否则原样返回用户自定义的名字。
function profileDisplayName(profile) {
  const name = profile && profile.name;
  if (DEFAULT_PROFILE_NAMES.includes(name)) {
    return t("profileDefaultName");
  }
  return name;
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
    config.language = normalizeLanguage(config.language);
    // 旧版本允许响应头及 append/remove。新版本统一为请求头 set，
    // 并移除废弃字段，避免后续导出继续携带已不支持的配置。
    let changed = false;
    for (const profile of config.profiles) {
      if (!Array.isArray(profile.rules)) continue;
      for (const rule of profile.rules) {
        if (Object.prototype.hasOwnProperty.call(rule, "target")) {
          delete rule.target;
          changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(rule, "operation")) {
          delete rule.operation;
          changed = true;
        }
      }
    }
    if (changed) {
      await browserAPI.storage.local.set({ [CONFIG_KEY]: config });
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
  for (const rule of legacyRules) {
    delete rule.target;
    delete rule.operation;
  }
  ensureNumIds(migrated.profiles[0].rules);

  await browserAPI.storage.local.set({ [CONFIG_KEY]: migrated });
  await browserAPI.storage.local.remove(LEGACY_STORAGE_KEY);
  return migrated;
}

async function saveConfig(config) {
  await browserAPI.storage.local.set({ [CONFIG_KEY]: config });
}

// 语言字段容错：老数据或外部导入的文件可能没有 / 填了不支持的值
function normalizeLanguage(lang) {
  return LANG_LOCALE_DIR[lang] ? lang : detectDefaultLanguage();
}

// —— 跨界面同步 ——
// popup 与 options 各自持有一份 config 内存副本，且每次写入都整体覆盖
// appConfig。若不感知别人的改动，后写的界面会用自己那份旧副本把对方
// （最典型的是「导入配置」的结果）整体冲掉。这里订阅 appConfig 的外部
// 变更，让界面拿到最新数据后重新渲染。
// getLocalConfig 用于识别「这次变更就是自己写的」，此时无需重复渲染。
function onExternalConfigChange(getLocalConfig, handler) {
  browserAPI.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[CONFIG_KEY]) return;
    const next = changes[CONFIG_KEY].newValue;
    if (!next || !Array.isArray(next.profiles) || !next.profiles.length) return;
    const local = getLocalConfig();
    // 界面还没初始化完，init() 自己会读到最新数据
    if (!local) return;
    if (JSON.stringify(next) === JSON.stringify(local)) return;
    handler(next);
  });
}

function getActiveProfile(config) {
  return (
    config.profiles.find((p) => p.id === config.activeProfileId) ||
    config.profiles[0]
  );
}

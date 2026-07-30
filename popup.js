// popup.js
// 快捷面板：编辑当前启用配置档的规则、切换配置档与总开关。
// 所有变更写回 storage.local（appConfig），background.js 监听后自动刷新
// declarativeNetRequest 规则。完整管理（批量、导入导出等）见选项页。

const ruleListEl = document.getElementById("ruleList");
const emptyHintEl = document.getElementById("emptyHint");
const statusBarEl = document.getElementById("statusBar");
const globalSwitchEl = document.getElementById("globalSwitch");
const langSelectEl = document.getElementById("langSelect");
const profileSelectEl = document.getElementById("profileSelect");
const addBtn = document.getElementById("addBtn");
const optionsBtn = document.getElementById("optionsBtn");
const template = document.getElementById("ruleTemplate");

let config = null;
let lastSyncStatus = null;

function activeRules() {
  return getActiveProfile(config).rules;
}

// —— 渲染 ——
function renderProfileSelect() {
  profileSelectEl.innerHTML = "";
  for (const profile of config.profiles) {
    const opt = document.createElement("option");
    opt.value = profile.id;
    opt.textContent = profileDisplayName(profile);
    profileSelectEl.appendChild(opt);
  }
  profileSelectEl.value = getActiveProfile(config).id;
}

// 状态栏：总开关关闭 > 同步错误 > 隐藏
function renderStatus() {
  if (!config.globalEnabled) {
    statusBarEl.textContent = t("globalOffHint");
    statusBarEl.className = "status-bar warn";
    statusBarEl.hidden = false;
  } else if (lastSyncStatus && lastSyncStatus.ok === false) {
    statusBarEl.textContent = t("syncErrorPrefix") + lastSyncStatus.error;
    statusBarEl.className = "status-bar error";
    statusBarEl.hidden = false;
  } else {
    statusBarEl.hidden = true;
  }
}

function render() {
  const rules = activeRules();
  document.body.classList.toggle("paused", !config.globalEnabled);
  ruleListEl.innerHTML = "";
  emptyHintEl.style.display = rules.length ? "none" : "block";

  rules.forEach((rule) => {
    const node = template.content.cloneNode(true);
    applyI18n(node);
    const item = node.querySelector(".rule-item");
    item.dataset.id = rule.id;

    const enabledEl = node.querySelector(".rule-enabled");
    const targetEl = node.querySelector(".rule-target");
    const operationEl = node.querySelector(".rule-operation");
    const nameEl = node.querySelector(".rule-header-name");
    const valueEl = node.querySelector(".rule-header-value");
    const urlEl = node.querySelector(".rule-url-pattern");
    const deleteBtn = node.querySelector(".rule-delete");

    enabledEl.checked = rule.enabled;
    targetEl.value = rule.target || "request";
    operationEl.value = rule.operation || "set";
    nameEl.value = rule.headerName;
    valueEl.value = rule.headerValue;
    urlEl.value = rule.urlPattern || "";

    // remove 操作不需要 value，隐藏该输入行
    const syncValueVisibility = () => {
      valueEl.parentElement.style.display =
        operationEl.value === "remove" ? "none" : "";
    };
    syncValueVisibility();

    // 启用但 key 为空的规则不会生效，给出红框提示
    const markInvalid = () => {
      nameEl.classList.toggle(
        "input-invalid",
        enabledEl.checked && !nameEl.value.trim()
      );
    };
    markInvalid();

    // 事件绑定：任意字段变更即更新内存并落盘
    enabledEl.addEventListener("change", () => {
      updateRule(rule.id, { enabled: enabledEl.checked });
      markInvalid();
    });
    targetEl.addEventListener("change", () => {
      updateRule(rule.id, { target: targetEl.value });
    });
    operationEl.addEventListener("change", () => {
      updateRule(rule.id, { operation: operationEl.value });
      syncValueVisibility();
    });
    nameEl.addEventListener("input", () => {
      updateRule(rule.id, { headerName: nameEl.value }, false);
      markInvalid();
    });
    nameEl.addEventListener("change", () => saveConfig(config));
    valueEl.addEventListener("input", () => {
      updateRule(rule.id, { headerValue: valueEl.value }, false);
    });
    valueEl.addEventListener("change", () => saveConfig(config));
    urlEl.addEventListener("input", () => {
      updateRule(rule.id, { urlPattern: urlEl.value }, false);
    });
    urlEl.addEventListener("change", () => saveConfig(config));

    deleteBtn.addEventListener("click", () => deleteRule(rule.id));

    ruleListEl.appendChild(node);
  });
}

// —— 增删改 ——
// persist=false 时只更新内存不立即写盘（用于 input 高频输入，配合 change 事件落盘）
function updateRule(id, patch, persist = true) {
  const rules = activeRules();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx === -1) return;
  rules[idx] = { ...rules[idx], ...patch };
  if (persist) saveConfig(config);
}

async function addRule() {
  const rules = activeRules();
  rules.push(createEmptyRule(rules));
  await saveConfig(config);
  render();
}

async function deleteRule(id) {
  const profile = getActiveProfile(config);
  profile.rules = profile.rules.filter((r) => r.id !== id);
  await saveConfig(config);
  render();
}

// —— 初始化 ——
addBtn.addEventListener("click", addRule);

optionsBtn.addEventListener("click", () => {
  browserAPI.runtime.openOptionsPage();
  window.close();
});

document.getElementById("helpBtn").addEventListener("click", () => {
  browserAPI.tabs.create({ url: browserAPI.runtime.getURL("help.html") });
  window.close();
});

// 切换语言：写入配置后整页重载，用新语言包重新渲染（popup 保持打开）
langSelectEl.addEventListener("change", async () => {
  config.language = langSelectEl.value;
  await saveConfig(config);
  location.reload();
});

globalSwitchEl.addEventListener("change", async () => {
  config.globalEnabled = globalSwitchEl.checked;
  await saveConfig(config);
  render();
  renderStatus();
});

profileSelectEl.addEventListener("change", async () => {
  config.activeProfileId = profileSelectEl.value;
  await saveConfig(config);
  render();
});

// 后台同步结果实时反馈到状态栏
browserAPI.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[SYNC_STATUS_KEY]) {
    lastSyncStatus = changes[SYNC_STATUS_KEY].newValue;
    renderStatus();
  }
});

(async function init() {
  config = await loadConfig();
  await initI18n(config.language);
  applyI18n();
  document.title = t("popupTitle");

  globalSwitchEl.checked = config.globalEnabled;
  langSelectEl.value = config.language;

  const data = await browserAPI.storage.local.get(SYNC_STATUS_KEY);
  lastSyncStatus = data[SYNC_STATUS_KEY] || null;

  renderProfileSelect();
  render();
  renderStatus();
})();

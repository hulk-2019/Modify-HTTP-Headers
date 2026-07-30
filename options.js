// options.js
// 完整管理页面：配置档 CRUD、规则表格（搜索 / 排序 / 批量）、
// 导入导出。数据模型与 popup 共用（common.js）。
//
// 配置档与规则联动：规则区始终展示并编辑「当前启用」的配置档，
// 在配置档区切换启用后，规则列表同步跟随。

const els = {
  globalSwitch: document.getElementById("globalSwitch"),
  statusBar: document.getElementById("statusBar"),
  profileList: document.getElementById("profileList"),
  profileAddBtn: document.getElementById("profileAddBtn"),
  activeProfileName: document.getElementById("activeProfileName"),
  langSelect: document.getElementById("langSelect"),
  searchInput: document.getElementById("searchInput"),
  addRuleBtn: document.getElementById("addRuleBtn"),
  selectAll: document.getElementById("selectAll"),
  batchEnableBtn: document.getElementById("batchEnableBtn"),
  batchDisableBtn: document.getElementById("batchDisableBtn"),
  batchDeleteBtn: document.getElementById("batchDeleteBtn"),
  ruleTbody: document.getElementById("ruleTbody"),
  rulesEmpty: document.getElementById("rulesEmpty"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFile: document.getElementById("importFile"),
  dataMsg: document.getElementById("dataMsg")
};

const profileItemTemplate = document.getElementById("profileItemTemplate");
const ruleRowTemplate = document.getElementById("ruleRowTemplate");

let config = null;
let lastSyncStatus = null;
let selectedRuleIds = new Set();

// 规则区编辑的始终是当前启用的配置档
function editingProfile() {
  return getActiveProfile(config);
}

async function persist() {
  await saveConfig(config);
}

// —— 状态栏 ——
function renderStatus() {
  if (!config.globalEnabled) {
    els.statusBar.textContent = t("globalOffHint");
    els.statusBar.className = "status-bar warn";
    els.statusBar.hidden = false;
  } else if (lastSyncStatus && lastSyncStatus.ok === false) {
    els.statusBar.textContent = t("syncErrorPrefix") + lastSyncStatus.error;
    els.statusBar.className = "status-bar error";
    els.statusBar.hidden = false;
  } else {
    els.statusBar.hidden = true;
  }
}

// —— 配置档 ——
function renderProfiles() {
  els.profileList.innerHTML = "";

  for (const profile of config.profiles) {
    const node = profileItemTemplate.content.cloneNode(true);
    applyI18n(node);

    const activeEl = node.querySelector(".profile-active");
    const nameEl = node.querySelector(".profile-name");
    const metaEl = node.querySelector(".profile-meta");
    const badgeEl = node.querySelector(".badge-active");
    const deleteBtn = node.querySelector(".profile-delete");

    const isActive = profile.id === config.activeProfileId;
    activeEl.checked = isActive;
    badgeEl.hidden = !isActive;
    nameEl.value = profileDisplayName(profile);
    metaEl.textContent = t("ruleCount", [String(profile.rules.length)]);
    // 只剩一个配置档时不允许删除
    deleteBtn.disabled = config.profiles.length <= 1;

    activeEl.addEventListener("change", async () => {
      config.activeProfileId = profile.id;
      selectedRuleIds.clear();
      els.selectAll.checked = false;
      await persist();
      renderProfiles();
      renderActiveProfileName();
      renderRules();
    });
    nameEl.addEventListener("change", async () => {
      profile.name = nameEl.value.trim() || profile.name;
      nameEl.value = profile.name;
      await persist();
      renderActiveProfileName();
    });
    deleteBtn.addEventListener("click", async () => {
      if (!confirm(t("profileDeleteConfirm"))) return;
      config.profiles = config.profiles.filter((p) => p.id !== profile.id);
      if (config.activeProfileId === profile.id) {
        config.activeProfileId = config.profiles[0].id;
        selectedRuleIds.clear();
        els.selectAll.checked = false;
      }
      await persist();
      renderAll();
    });

    els.profileList.appendChild(node);
  }
}

async function addProfile() {
  const profile = createProfile(
    `${t("profileNewName")} ${config.profiles.length + 1}`
  );
  config.profiles.push(profile);
  await persist();
  renderProfiles();
}

// —— 规则表格 ——
// 规则区标题旁展示当前启用的配置档名，强调联动关系
function renderActiveProfileName() {
  els.activeProfileName.textContent = profileDisplayName(editingProfile());
}

function filteredRules() {
  const keyword = els.searchInput.value.trim().toLowerCase();
  const rules = editingProfile().rules;
  if (!keyword) return rules;
  return rules.filter((r) =>
    [r.headerName, r.headerValue, r.urlPattern || ""]
      .join("\n")
      .toLowerCase()
      .includes(keyword)
  );
}

function renderRules() {
  const profile = editingProfile();
  const visible = filteredRules();

  els.ruleTbody.innerHTML = "";
  els.rulesEmpty.hidden = profile.rules.length > 0;

  visible.forEach((rule) => {
    const node = ruleRowTemplate.content.cloneNode(true);
    applyI18n(node);
    const row = node.querySelector(".rule-row");
    row.dataset.id = rule.id;

    const selEl = node.querySelector(".row-sel");
    const enabledEl = node.querySelector(".rule-enabled");
    const nameEl = node.querySelector(".rule-header-name");
    const valueEl = node.querySelector(".rule-header-value");
    const urlEl = node.querySelector(".rule-url-pattern");
    const upBtn = node.querySelector(".rule-up");
    const downBtn = node.querySelector(".rule-down");
    const deleteBtn = node.querySelector(".rule-delete");

    selEl.checked = selectedRuleIds.has(rule.id);
    enabledEl.checked = rule.enabled;
    nameEl.value = rule.headerName;
    valueEl.value = rule.headerValue;
    urlEl.value = rule.urlPattern || "";

    const markInvalid = () => {
      nameEl.classList.toggle(
        "input-invalid",
        enabledEl.checked && !nameEl.value.trim()
      );
    };
    markInvalid();

    selEl.addEventListener("change", () => {
      if (selEl.checked) selectedRuleIds.add(rule.id);
      else selectedRuleIds.delete(rule.id);
    });
    enabledEl.addEventListener("change", () => {
      rule.enabled = enabledEl.checked;
      markInvalid();
      persist();
    });
    nameEl.addEventListener("input", markInvalid);
    nameEl.addEventListener("change", () => {
      rule.headerName = nameEl.value;
      persist();
    });
    valueEl.addEventListener("change", () => {
      rule.headerValue = valueEl.value;
      persist();
    });
    urlEl.addEventListener("change", () => {
      rule.urlPattern = urlEl.value;
      persist();
    });
    upBtn.addEventListener("click", () => moveRule(rule.id, -1));
    downBtn.addEventListener("click", () => moveRule(rule.id, 1));
    deleteBtn.addEventListener("click", async () => {
      profile.rules = profile.rules.filter((r) => r.id !== rule.id);
      selectedRuleIds.delete(rule.id);
      await persist();
      renderRules();
      renderProfiles();
    });

    els.ruleTbody.appendChild(node);
  });
}

async function moveRule(id, delta) {
  const rules = editingProfile().rules;
  const idx = rules.findIndex((r) => r.id === id);
  const next = idx + delta;
  if (idx === -1 || next < 0 || next >= rules.length) return;
  [rules[idx], rules[next]] = [rules[next], rules[idx]];
  await persist();
  renderRules();
}

async function addRule() {
  const rules = editingProfile().rules;
  rules.push(createEmptyRule(rules));
  await persist();
  renderRules();
  renderProfiles();
}

// —— 批量操作（作用于搜索过滤后被勾选的规则）——
function selectedVisibleRules() {
  return filteredRules().filter((r) => selectedRuleIds.has(r.id));
}

async function batchSetEnabled(enabled) {
  for (const rule of selectedVisibleRules()) rule.enabled = enabled;
  await persist();
  renderRules();
}

async function batchDelete() {
  const targets = selectedVisibleRules();
  if (!targets.length || !confirm(t("batchDeleteConfirm"))) return;
  const ids = new Set(targets.map((r) => r.id));
  const profile = editingProfile();
  profile.rules = profile.rules.filter((r) => !ids.has(r.id));
  for (const id of ids) selectedRuleIds.delete(id);
  await persist();
  renderRules();
  renderProfiles();
}

// —— 导入 / 导出 ——
function showDataMsg(text) {
  els.dataMsg.textContent = text;
  els.dataMsg.hidden = false;
}

function exportConfig() {
  const payload = {
    type: "modify-http-headers-config",
    version: 2,
    exportedAt: new Date().toISOString(),
    globalEnabled: config.globalEnabled,
    language: config.language,
    activeProfileId: config.activeProfileId,
    profiles: config.profiles
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `modify-http-headers-config-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importConfig(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (_) {
    showDataMsg(t("importInvalid"));
    return;
  }

  if (!parsed || !Array.isArray(parsed.profiles) || !parsed.profiles.length) {
    showDataMsg(t("importInvalid"));
    return;
  }
  if (!confirm(t("importReplaceConfirm"))) return;

  // 重建配置：只保留已知字段，规则逐条 sanitize，保证 numId 唯一
  const profiles = parsed.profiles.map((p) => {
    const profile = createProfile(
      typeof p.name === "string" && p.name.trim()
        ? p.name.trim()
        : t("profileDefaultName")
    );
    const rawRules = Array.isArray(p.rules) ? p.rules : [];
    for (const raw of rawRules) {
      profile.rules.push(sanitizeRule(raw, profile.rules));
    }
    // 尽量保留原 id，便于 activeProfileId 对应
    if (typeof p.id === "string" && p.id) profile.id = p.id;
    return profile;
  });

  const prevLanguage = config.language;
  config = {
    globalEnabled: parsed.globalEnabled !== false,
    // 文件里没带语言（旧版本导出）时沿用当前界面语言，不要退回浏览器默认值
    language: LANG_LOCALE_DIR[parsed.language] ? parsed.language : prevLanguage,
    activeProfileId: profiles.some((p) => p.id === parsed.activeProfileId)
      ? parsed.activeProfileId
      : profiles[0].id,
    profiles
  };
  selectedRuleIds.clear();

  await persist();
  if (config.language !== prevLanguage) {
    location.reload();
    return;
  }
  renderAll();
  showDataMsg(t("importSuccess"));
}

// —— 整体渲染 ——
function renderAll() {
  els.globalSwitch.checked = config.globalEnabled;
  renderStatus();
  renderProfiles();
  renderActiveProfileName();
  renderRules();
}

// —— 事件绑定 ——
els.globalSwitch.addEventListener("change", async () => {
  config.globalEnabled = els.globalSwitch.checked;
  await persist();
  renderStatus();
});

// 切换语言：写入配置后整页重载，用新语言包重新渲染
els.langSelect.addEventListener("change", async () => {
  config.language = els.langSelect.value;
  await saveConfig(config);
  location.reload();
});

els.profileAddBtn.addEventListener("click", addProfile);

els.searchInput.addEventListener("input", renderRules);
els.addRuleBtn.addEventListener("click", addRule);

els.selectAll.addEventListener("change", () => {
  const visible = filteredRules();
  if (els.selectAll.checked) {
    for (const r of visible) selectedRuleIds.add(r.id);
  } else {
    for (const r of visible) selectedRuleIds.delete(r.id);
  }
  renderRules();
});

els.batchEnableBtn.addEventListener("click", () => batchSetEnabled(true));
els.batchDisableBtn.addEventListener("click", () => batchSetEnabled(false));
els.batchDeleteBtn.addEventListener("click", batchDelete);

els.exportBtn.addEventListener("click", exportConfig);
els.importBtn.addEventListener("click", () => els.importFile.click());
els.importFile.addEventListener("change", () => {
  const file = els.importFile.files[0];
  els.importFile.value = "";
  if (file) importConfig(file);
});

// 后台同步结果实时反馈
browserAPI.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[SYNC_STATUS_KEY]) {
    lastSyncStatus = changes[SYNC_STATUS_KEY].newValue;
    renderStatus();
  }
});

// 别处（popup / 另一个选项页）改了配置：换成最新数据重新渲染，
// 否则本页那份旧副本一落盘就会把对方的改动覆盖掉
onExternalConfigChange(
  () => config,
  (next) => {
    // 语言变了要用新语言包重新渲染整页
    if (normalizeLanguage(next.language) !== config.language) {
      location.reload();
      return;
    }
    config = next;
    config.language = normalizeLanguage(config.language);
    selectedRuleIds.clear();
    els.selectAll.checked = false;
    renderAll();
  }
);

// —— 初始化 ——
(async function init() {
  config = await loadConfig();
  await initI18n(config.language);
  applyI18n();
  document.title = t("optionsTitle");

  els.langSelect.value = config.language;

  const data = await browserAPI.storage.local.get(SYNC_STATUS_KEY);
  lastSyncStatus = data[SYNC_STATUS_KEY] || null;

  renderAll();
})();

#!/usr/bin/env node
// scripts/build.js
// 分浏览器打包：以根目录 manifest.json 为基底，裁剪出 Chrome / Firefox
// 各自的干净 manifest，拷贝源文件到 dist/<target>/，并压成 zip。
// 零第三方依赖，仅用 Node 内置模块 + 系统 zip 命令。

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

// 需要拷贝进包里的源文件（不含 manifest.json，manifest 单独裁剪写入）
const ASSETS = [
  "background.js",
  "browser-polyfill.js",
  "common.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "options.html",
  "options.js",
  "options.css",
  "help.html",
  "help.js",
  "help.css",
  "_locales",
  "icons"
];

// 读取基底 manifest
const baseManifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")
);

// 深拷贝，避免两个 target 互相污染
const clone = (obj) => JSON.parse(JSON.stringify(obj));

// —— 两个 target 的 manifest 裁剪规则 ——
// 根目录 manifest.json 即 Chrome 格式（可直接在 Chrome 加载、无告警），
// Firefox 专用字段（background.scripts / browser_specific_settings）在此注入。
function buildChromeManifest() {
  return clone(baseManifest);
}

function buildFirefoxManifest() {
  const m = clone(baseManifest);
  // Firefox MV3 不支持 service_worker，走 background.scripts
  m.background = { scripts: ["browser-polyfill.js", "common.js", "background.js"] };
  m.browser_specific_settings = {
    gecko: {
      id: "modify-http-headers@example.com",
      strict_min_version: "128.0"
    }
  };
  return m;
}

const TARGETS = {
  chrome: buildChromeManifest,
  firefox: buildFirefoxManifest
};

// 递归拷贝文件/目录
function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function build(target) {
  // 构建到 dist/<target>/（保留解压目录，可直接在浏览器加载调试），再压成 zip
  const outDir = path.join(DIST, target);
  rmrf(outDir);
  fs.mkdirSync(outDir, { recursive: true });

  // 1. 写入裁剪后的 manifest
  const manifest = TARGETS[target]();
  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );

  // 2. 拷贝源文件
  for (const asset of ASSETS) {
    const src = path.join(ROOT, asset);
    if (!fs.existsSync(src)) {
      console.warn(`  ! 跳过不存在的文件: ${asset}`);
      continue;
    }
    copyRecursive(src, path.join(outDir, asset));
  }

  // 3. 压成 zip（进入 outDir 打包，保证包内路径干净无前缀）
  const version = manifest.version || "0.0.0";
  const zipName = `${target}-v${version}.zip`;
  const zipPath = path.join(DIST, zipName);
  rmrf(zipPath);
  execFileSync("zip", ["-r", "-q", zipPath, "."], { cwd: outDir });

  console.log(`✓ ${target.padEnd(8)} → dist/${zipName}（解压目录 dist/${target}/）`);
  return zipName;
}

// 在 dist 下生成一份安装说明（纯文本）
// function writeInstallGuide(zips) {
//   const guide = `安装说明
// ========
//
// 本目录下 chrome/、firefox/ 为可直接加载的插件目录，
// zip 为对应的分发压缩包（内容相同，解压后同样可加载）。
//
//
// 【Chrome / Edge】  chrome/ 目录（或 ${zips.chrome || "chrome-*.zip"}）
//
// 1. 打开 chrome://extensions （Edge 为 edge://extensions）
// 2. 开启右上角「开发者模式」
// 3. 点击「加载已解压的扩展程序」，选择 chrome/ 目录
// 4. 工具栏出现图标即安装成功
//
//
// 【Firefox 128+】  firefox/ 目录（或 ${zips.firefox || "firefox-*.zip"}）
//
// 1. 打开 about:debugging#/runtime/this-firefox
// 2. 点击「临时载入附加组件」，选择 firefox/ 目录里的 manifest.json
// 3. 工具栏出现图标即安装成功
//
// * 临时载入的插件在 Firefox 重启后会消失，需重新载入；
//   正式分发需打包为 .xpi 并签名。
//
//
// 【使用】
//
// 1. 点击工具栏图标打开弹窗
// 2. 「+ 新增规则」，选择目标（请求头/响应头）和操作（set/append/remove）
// 3. 填写头名称(key)和值(value)（remove 操作无需填值）
// 4. 可选填写 URL 匹配（如 *://api.example.com/*），留空对所有请求生效
// 5. 用开关启用 / 停用，点 ✕ 删除；右上角总开关可一键暂停所有规则
// 6. 点「管理」打开完整管理页：配置档、搜索、批量操作、导入导出、命中统计
//
// 改动即时保存并生效。
// `;
//   fs.writeFileSync(path.join(DIST, "INSTALL.txt"), guide);
//   console.log("✓ 安装说明 → dist/INSTALL.txt");
// }

// —— 入口 ——
// 用法: node scripts/build.js [chrome|firefox]  不带参数则两个都打
const arg = process.argv[2];
const list = arg ? [arg] : Object.keys(TARGETS);

const zips = {};
for (const t of list) {
  if (!TARGETS[t]) {
    console.error(`未知 target: ${t}（可选: ${Object.keys(TARGETS).join(", ")}）`);
    process.exit(1);
  }
  zips[t] = build(t);
}

// writeInstallGuide(zips);

console.log("打包完成。");

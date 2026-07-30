// help.js
// 帮助页：正文以中英两套内容块内置在页面里（长文案不适合放 messages.json），
// 根据用户在管理页选择的界面语言（config.language，默认英文）显示其中一套。
(async function init() {
  const config = await loadConfig();
  const isZh = config.language === "zh";
  document.title = isZh
    ? "Modify HTTP Headers · 帮助"
    : "Modify HTTP Headers · Help";
  document.querySelectorAll("[data-lang]").forEach((el) => {
    el.hidden = (el.dataset.lang === "zh") !== isZh;
  });
})();

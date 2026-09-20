"use strict";

// 界面层冒烟测试：在 jsdom 中加载 index.html，完整走一遍交付闭环。
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
const { window } = dom;
const { document } = window;

// jsdom 未实现或行为受限的 API 在此打桩
window.prompt = () => "木箱";
window.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
window.HTMLDialogElement.prototype.show = function () {
  this.open = true;
};
window.HTMLDialogElement.prototype.close = function () {
  this.open = false;
};

for (const src of ["js/rules.js", "js/store.js", "js/ui.js"]) {
  window.eval(fs.readFileSync(path.join(root, src), "utf8"));
}

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}
function stored() {
  return JSON.parse(window.localStorage.getItem("zfl42Works"));
}
function colCount(status) {
  const cols = [...document.querySelectorAll("#board .col")];
  const col = cols.find(c => c.querySelector("h3 span").textContent === status);
  return col ? col.querySelectorAll(".item").length : -1;
}
function clickAction(action) {
  const btn = document.querySelector(`[data-action="${action}"]`);
  if (!btn) throw new Error(`找不到按钮 ${action}`);
  btn.click();
}
function setField(form, name, value) {
  form.elements.namedItem(name).value = value;
}
function statsText() {
  return document.querySelector("#statsBar").textContent;
}

console.log("初始渲染：");
check("风险统计栏已渲染 8 项", document.querySelectorAll("#statsBar .stat").length === 8);
check("看板含 7 个状态列", document.querySelectorAll("#board .col").length === 7);
check("待交付列有 1 件作品", colCount("待交付") === 1);

console.log("创建包装清单：");
clickAction("pack");
check("作品进入已包装列", colCount("已包装") === 1);
check("待交付列清空", colCount("待交付") === 0);
check("持久化状态为已包装", stored().find(w => w.theme === "宝相花").status === "已包装");
check("清单为未结束", stored().find(w => w.theme === "宝相花").packings[0].status === "active");

console.log("签收（缺项拒绝 → 补齐后成功）：");
clickAction("signoff"); // 打开签收弹窗
const form = document.querySelector("#signoffForm");
setField(form, "recipient", ""); // 缺收货人
form.querySelector('button[type="submit"]').click();
check("缺收货人被拒绝并提示", document.querySelector("#signoffError").textContent.includes("收货人"));
check("状态仍未签收", stored().find(w => w.theme === "宝相花").status === "已包装");

setField(form, "recipient", "张三");
form.querySelector('button[type="submit"]').click();
check("签收成功进入已签收列", colCount("已签收") === 1);
const signed = stored().find(w => w.theme === "宝相花");
check("签收记录含收货人与实际交付日期", signed.signoffs[0].recipient === "张三" && !!signed.signoffs[0].actualDate);
check("签收号唯一且非空", !!signed.signoffs[0].receiptNo);
check("签收后清单结束", signed.packings[0].status === "done");
check("最近交付列表出现该签收", document.querySelector("#deliveryList").textContent.includes(signed.signoffs[0].receiptNo));

console.log("签收后返工 → 再签收：");
clickAction("rework");
check("进入返工中列", colCount("返工中") === 1);
let cur = stored().find(w => w.theme === "宝相花");
check("追加返工记录且原签收保留", cur.reworks.length === 1 && cur.signoffs.length === 1);

clickAction("finishRework");
check("完成返工退回待交付", colCount("待交付") === 1);

clickAction("pack");
check("重新包装", colCount("已包装") === 1);
clickAction("signoff");
setField(form, "recipient", "张三");
form.querySelector('button[type="submit"]').click();
cur = stored().find(w => w.theme === "宝相花");
check("返工后再签收成功", cur.status === "已签收" && cur.signoffs.length === 2);
check("两次签收号不同", cur.signoffs[0].receiptNo !== cur.signoffs[1].receiptNo);

console.log("包装后调整关键字段 → 清单失效：");
// 先让作品回到待交付并重新包装
clickAction("rework");
clickAction("finishRework");
clickAction("pack");
check("再次进入已包装", colCount("已包装") === 1);
// 打开详情弹窗，再点编辑（编辑入口在详情弹窗内）
const targetId = stored().find(w => w.theme === "宝相花").id;
document.querySelector(`[data-detail="${targetId}"]`).click();
check("详情弹窗已打开", document.querySelector("#detailDialog").open === true);
clickAction("edit");
const editForm = document.querySelector("#editForm");
setField(editForm, "dryDate", "2026-09-19");
editForm.querySelector('button[type="submit"]').click();
cur = stored().find(w => w.theme === "宝相花");
check("关键字段调整后退回待交付", cur.status === "待交付");
check("未结束清单已失效", cur.packings[cur.packings.length - 1].status === "invalid");
check("风险统计包含清单失效次数", statsText().includes("清单失效次数"));

console.log("刷新后状态一致：");
{
  // 用同一份 localStorage 重新加载页面脚本，模拟刷新
  const dom2 = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const w2 = dom2.window;
  w2.prompt = () => "木箱";
  w2.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w2.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  // 复用之前的 localStorage 数据
  const snapshot = window.localStorage.getItem("zfl42Works");
  w2.localStorage.setItem("zfl42Works", snapshot);
  for (const src of ["js/rules.js", "js/store.js", "js/ui.js"]) {
    w2.eval(fs.readFileSync(path.join(root, src), "utf8"));
  }
  const reloaded = JSON.parse(w2.localStorage.getItem("zfl42Works")).find(x => x.theme === "宝相花");
  check("刷新后签收与返工历史保留", reloaded.signoffs.length === 2 && reloaded.reworks.length === 2);
  check("刷新后看板状态一致", reloaded.status === "待交付");
  const stats2 = w2.document.querySelector("#statsBar").textContent;
  check("刷新后风险统计一致", stats2 === statsText());
}

console.log(`\n${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);

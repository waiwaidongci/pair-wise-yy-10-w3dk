const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const ORIGIN = "http://127.0.0.1:3999/";

// 跨 jsdom 实例共享的 localStorage 后端，用来模拟“刷新后”
const sharedStore = new Map();

async function launch() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const dom = new JSDOM(html, {
    url: ORIGIN,
    runScripts: "outside-only",
    beforeParse(window) {
      window.__sharedLS = sharedStore;
      window.eval(`
        const _data = window.__sharedLS;
        Object.defineProperty(window, "localStorage", {
          value: {
            getItem: k => _data.has(k) ? _data.get(k) : null,
            setItem: (k, v) => _data.set(k, String(v)),
            removeItem: k => _data.delete(k)
          }
        });
      `);
    }
  });
  // 手动按顺序执行三个脚本，与页面 <script src> 的加载顺序一致
  for (const rel of ["js/rules.js", "js/store.js", "js/app.js"]) {
    dom.window.eval(fs.readFileSync(path.join(root, rel), "utf8"));
  }
  await new Promise(r => setTimeout(r, 20));
  // jsdom 未实现 HTMLDialogElement.showModal/close，测试用最小垫片
  dom.window.document.querySelectorAll("dialog").forEach(d => {
    if (!d.showModal) d.showModal = function () { this.open = true; };
    if (!d.show) d.show = function () { this.open = true; };
    if (!d.close) d.close = function () { this.open = false; };
  });
  return dom;
}

test("端到端：包装 -> 签收缺项拒绝 -> 签收 -> 返工 -> 再签收，界面与持久化一致", async () => {
  sharedStore.clear();
  const dom = await launch();
  const { window } = dom;
  const doc = window.document;
  const R = window.Rules;

    // 种子里有一件“待交付”（缠枝莲）
    let stored = JSON.parse(window.localStorage.getItem("zfl42Works"));
    let w = R.normalizeAll(stored).find(x => x.theme === "缠枝莲");
    assert.ok(w, "应存在待交付种子作品");
    assert.equal(w.status, "待交付");
    assert.ok(doc.querySelector("#riskChips").textContent.includes("未结束包装 0"));

    // 1) 建立包装清单（通过界面按钮）
    window.openPack(w.id);
    assert.ok(doc.querySelector("#packDialog").open);
    doc.querySelector("#packItems .pack-name").value = "锦盒";
    doc.querySelector("#packItems .pack-qty").value = "1";
    doc.querySelector("#submitPack").click();
    assert.equal(doc.querySelector("#packDialog").open, false);

    stored = JSON.parse(window.localStorage.getItem("zfl42Works"));
    w = R.normalizeAll(stored).find(x => x.id === w.id);
    assert.equal(w.status, "待签收");
    assert.ok(doc.querySelector("#riskChips").textContent.includes("未结束包装 1"));

    // 2) 刷新页面后仍是待签收、清单仍在
    const dom2 = await launch();
    const doc2 = dom2.window.document;
    assert.ok(doc2.querySelector("#riskChips").textContent.includes("未结束包装 1"));
    const w2 = R.normalizeAll(JSON.parse(dom2.window.localStorage.getItem("zfl42Works"))).find(x => x.theme === "缠枝莲");
    assert.equal(w2.status, "待签收");

    // 3) 签收缺项 -> 拒绝，错误显示在对话框内
    dom2.window.openSign(w2.id);
    doc2.querySelector("#submitSign").click();
    assert.ok(doc2.querySelector("#signDialog").open, "缺项时对话框不应关闭");
    assert.match(doc2.querySelector("#signError").textContent, /收货人/);
    doc2.querySelector("#signReceiver").value = "陈师傅";
    doc2.querySelector("#signDate").value = "2026-09-20";
    doc2.querySelector("#submitSign").click();
    assert.ok(doc2.querySelector("#signDialog").open);
    assert.match(doc2.querySelector("#signError").textContent, /签收号/);

    // 填全后签收
    doc2.querySelector("#signReceipt").value = "QXD-E2E-001";
    doc2.querySelector("#submitSign").click();
    assert.equal(doc2.querySelector("#signDialog").open, false);
    let w3 = R.normalizeAll(JSON.parse(dom2.window.localStorage.getItem("zfl42Works"))).find(x => x.id === w2.id);
    assert.equal(w3.status, "已签收");
    assert.equal(R.latestReceipt(w3).receiptNo, "QXD-E2E-001");
    assert.ok(doc2.querySelector("#deliveryList").textContent.includes("QXD-E2E-001"));

    // 4) 签收后返工：空说明拒绝；原签收保留
    dom2.window.openRework(w3.id);
    doc2.querySelector("#submitRework").click();
    assert.ok(doc2.querySelector("#reworkDialog").open);
    doc2.querySelector("#reworkReason").value = "肩部补漆";
    doc2.querySelector("#submitRework").click();
    let w4 = R.normalizeAll(JSON.parse(dom2.window.localStorage.getItem("zfl42Works"))).find(x => x.id === w2.id);
    assert.equal(w4.status, "返工中");
    assert.equal(R.latestReceipt(w4).receiptNo, "QXD-E2E-001", "原签收保留");

    // 5) 返工完成 -> 再包装 -> 再签收
    dom2.window.finishRework(w4.id);
    w4 = R.normalizeAll(JSON.parse(dom2.window.localStorage.getItem("zfl42Works"))).find(x => x.id === w2.id);
    assert.equal(w4.status, "待交付");
    dom2.window.openPack(w4.id);
    doc2.querySelector("#packItems .pack-name").value = "新锦盒";
    doc2.querySelector("#submitPack").click();
    dom2.window.openSign(w4.id);
    doc2.querySelector("#signReceiver").value = "陈师傅";
    doc2.querySelector("#signDate").value = "2026-09-25";
    doc2.querySelector("#signReceipt").value = "QXD-E2E-002";
    doc2.querySelector("#submitSign").click();
    const w5 = R.normalizeAll(JSON.parse(dom2.window.localStorage.getItem("zfl42Works"))).find(x => x.id === w2.id);
    assert.equal(w5.status, "已签收");
    assert.equal(w5.packLists.length, 2);
    assert.equal(w5.packLists.filter(p => p.signoff).length, 2, "两次签收记录都保留");
    assert.equal(w5.rework.length, 1);
    assert.equal(w5.defectHistory.length, 0);
});

test("界面层：包装中编辑受保护字段使清单失效并退回待交付，统计同步", async () => {
  sharedStore.clear();
  const dom = await launch();
  const { window } = dom;
  const doc = window.document;
  const R = window.Rules;
  let w = R.normalizeAll(JSON.parse(window.localStorage.getItem("zfl42Works"))).find(x => x.theme === "缠枝莲");

  window.openPack(w.id);
  doc.querySelector("#packItems .pack-name").value = "锦盒";
  doc.querySelector("#submitPack").click();

  window.openEdit(w.id);
  assert.match(doc.querySelector("#editWarn").textContent, /立即失效/);
  doc.querySelector("#editForm").elements.line.value = "粗线";
  doc.querySelector("#submitEdit").click();

  const after = R.normalizeAll(JSON.parse(window.localStorage.getItem("zfl42Works"))).find(x => x.id === w.id);
  assert.equal(after.status, "待交付");
  assert.equal(after.packLists[0].status, "voided");
  assert.equal(after.line, "粗线");
  assert.ok(doc.querySelector("#riskChips").textContent.includes("已失效清单 1"));

  // 失效后允许重新建立包装
  assert.equal(R.activeList(after), null);
});

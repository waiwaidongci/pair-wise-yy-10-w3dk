"use strict";

// 规则层 + 持久化层的闭环规则测试（node test/closed-loop.test.js 运行）
const Rules = require("../js/rules.js");

// 为持久化层提供 localStorage 模拟
const memory = {};
global.localStorage = {
  getItem: k => (k in memory ? memory[k] : null),
  setItem: (k, v) => {
    memory[k] = String(v);
  },
  removeItem: k => {
    delete memory[k];
  }
};
const Store = require("../js/store.js");

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
function makeWork(overrides) {
  return {
    id: Rules.uid(),
    base: "木胎",
    theme: "缠枝莲",
    line: "细线",
    progress: 100,
    dryDate: "2026-09-10",
    gold: "已上金粉",
    defect: "",
    delivery: "2026-09-30",
    status: "待交付",
    note: "",
    logs: [],
    defectHistory: [],
    packings: [],
    signoffs: [],
    reworks: [],
    ...overrides
  };
}

console.log("包装清单：");
{
  const w = makeWork();
  const r1 = Rules.createPacking(w, "防震木箱");
  check("待交付可创建包装清单", r1.ok === true);
  check("创建后进入已包装", w.status === "已包装");
  check("存在一份未结束清单", Rules.activePacking(w) !== null);

  const r2 = Rules.createPacking(w, "重复");
  check("已包装作品不可重复创建清单", r2.ok === false);

  const w2 = makeWork({ status: "贴线中" });
  check("非待交付不可创建清单", Rules.createPacking(w2).ok === false);
}

console.log("包装后调整关键字段 → 清单失效并退回待交付：");
{
  const w = makeWork();
  Rules.createPacking(w, "木箱");
  const r = Rules.editWork(w, { dryDate: "2026-09-12" });
  check("调整阴干日期触发清单失效", r.invalidated !== null);
  check("作品退回待交付", w.status === "待交付");
  check("原清单标记为已失效", w.packings[0].status === "invalid");
  check("失效后无未结束清单", Rules.activePacking(w) === null);

  const w2 = makeWork();
  Rules.createPacking(w2, "木箱");
  const r2 = Rules.editWork(w2, { note: "仅改备注" });
  check("非关键字段不触发失效", r2.invalidated === null && w2.status === "已包装");

  const w3 = makeWork();
  Rules.createPacking(w3, "木箱");
  const r3 = Rules.recordDefect(w3, "右瓣断线");
  check("记录缺陷触发清单失效", r3.invalidated !== null && w3.status === "待交付");
  check("缺陷历史被保留", w3.defectHistory.length === 1 && w3.defectHistory[0].text === "右瓣断线");
}

console.log("签收：缺项拒绝 + 唯一签收号：");
{
  const works = [makeWork()];
  const w = works[0];
  Rules.createPacking(w, "木箱");
  check("缺收货人拒绝", Rules.signoff(works, w, { recipient: "", actualDate: "2026-09-20", receiptNo: "QS-1" }).ok === false);
  check("缺实际交付日期拒绝", Rules.signoff(works, w, { recipient: "张三", actualDate: "", receiptNo: "QS-1" }).ok === false);
  check("缺签收号拒绝", Rules.signoff(works, w, { recipient: "张三", actualDate: "2026-09-20", receiptNo: "" }).ok === false);

  const ok = Rules.signoff(works, w, { recipient: "张三", actualDate: "2026-09-20", receiptNo: "QS-1" });
  check("三项齐全可签收", ok.ok === true);
  check("签收后进入已签收", w.status === "已签收");
  check("签收后清单结束", w.packings[0].status === "done");

  const w2 = makeWork();
  works.push(w2);
  Rules.createPacking(w2, "木箱");
  const dup = Rules.signoff(works, w2, { recipient: "李四", actualDate: "2026-09-21", receiptNo: "QS-1" });
  check("签收号重复拒绝", dup.ok === false);

  const w3 = makeWork();
  check("未包装不可签收", Rules.signoff(works, w3, { recipient: "王五", actualDate: "2026-09-20", receiptNo: "QS-9" }).ok === false);
}

console.log("签收后返工：只追加返工记录，原签收与缺陷历史保留，返工后再签收：");
{
  const works = [makeWork({ defect: "左枝翘线" })];
  const w = works[0];
  w.defectHistory.push({ at: new Date().toISOString(), text: "左枝翘线" });
  Rules.createPacking(w, "木箱");
  Rules.signoff(works, w, { recipient: "张三", actualDate: "2026-09-20", receiptNo: "QS-1" });

  const rw = Rules.startRework(w, "金粉脱落补扫");
  check("已签收可发起返工", rw.ok === true);
  check("返工中状态", w.status === "返工中");
  check("追加返工记录", w.reworks.length === 1);
  check("原签收保留", w.signoffs.length === 1 && w.signoffs[0].receiptNo === "QS-1");
  check("缺陷历史保留", w.defectHistory.length === 1);

  const fin = Rules.finishRework(w, "已补扫金粉");
  check("完成返工退回待交付", fin.ok === true && w.status === "待交付");
  check("返工记录已完结", w.reworks[0].finishedAt !== null);

  Rules.createPacking(w, "新木箱");
  const re = Rules.signoff(works, w, { recipient: "张三", actualDate: "2026-09-25", receiptNo: "QS-2" });
  check("返工后可再签收", re.ok === true);
  check("两条签收记录均保留", w.signoffs.length === 2 && w.signoffs[1].receiptNo === "QS-2");

  const w2 = makeWork();
  check("未签收不可返工", Rules.startRework(w2, "x").ok === false);
}

console.log("状态流转限制：");
{
  const w = makeWork();
  check("生产状态不可手动改为已包装", Rules.updateStatus(w, "已包装").ok === false);
  Rules.createPacking(w, "木箱");
  check("已包装不可手动改回生产状态", Rules.updateStatus(w, "待交付").ok === false);
}

console.log("持久化：保存 / 读取一致，旧数据迁移：");
{
  const works = [makeWork()];
  Rules.createPacking(works[0], "木箱");
  Rules.signoff(works, works[0], { recipient: "张三", actualDate: "2026-09-20", receiptNo: "QS-1" });
  Store.save(works);
  const loaded = Store.load();
  check("保存后读取状态一致", loaded[0].status === "已签收" && loaded[0].signoffs[0].receiptNo === "QS-1");

  // 模拟旧版本数据（缺少闭环字段）
  memory[Store.KEY] = JSON.stringify([{ id: "old", theme: "旧作", status: "待交付", logs: [] }]);
  const migrated = Store.load();
  check(
    "旧数据补齐闭环数组字段",
    Array.isArray(migrated[0].packings) && Array.isArray(migrated[0].signoffs) && Array.isArray(migrated[0].reworks) && Array.isArray(migrated[0].defectHistory)
  );
}

console.log(`\n${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);

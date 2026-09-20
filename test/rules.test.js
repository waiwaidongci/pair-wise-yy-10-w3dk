const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../js/rules.js");

function makeWork(patch) {
  const r = R.createWork([], Object.assign({
    base: "木胎", theme: "缠枝莲", line: "细线", progress: 10,
    dryDate: "2026-09-10", delivery: "2026-09-25", status: "待交付"
  }, patch));
  assert.equal(r.ok, true, r.error);
  return r.works[0];
}

test("待交付作品只能有一份未结束包装清单", () => {
  let w = makeWork();
  let r = R.createPackList([w], w.id, [{ name: "锦盒", qty: "1" }]);
  assert.equal(r.ok, true);
  w = r.works[0];
  assert.equal(w.status, "待签收");
  assert.equal(w.packLists.length, 1);
  assert.equal(w.packLists[0].status, "active");

  // 再建一份被拒绝
  r = R.createPackList([w], w.id, [{ name: "防潮纸" }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /一份未结束/);

  // 非待交付状态不能建
  const w2 = makeWork({ theme: "云雷纹", status: "贴线中" });
  r = R.createPackList([w2], w2.id, [{ name: "锦盒" }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /待交付/);

  // 空清单拒绝
  r = R.createPackList([makeWork()], undefined);
  assert.equal(r.ok, false);
});

test("包装后调整胎体/纹样/线条/缺陷/阴干日期，清单立即失效并退回待交付", () => {
  let w = makeWork();
  let r = R.createPackList([w], w.id, [{ name: "锦盒" }]);
  w = r.works[0];
  const listId = w.packLists[0].id;

  for (const [field, value] of [
    ["base", "脱胎"], ["theme", "海水"], ["line", "粗线"], ["dryDate", "2026-09-12"]
  ]) {
    r = R.editWork([w], w.id, { [field]: value });
    assert.equal(r.ok, true, `${field} 调整应成功`);
    w = r.works[0];
    assert.equal(w.status, "待交付", `${field} 变更后应退回待交付`);
    const p = w.packLists.find(x => x.id === listId);
    assert.equal(p.status, "voided", `${field} 变更应失效清单`);
    assert.ok(p.voidedAt);
    assert.match(p.voidReason, /失效/);
    assert.equal(w[field], value);

    // 失效后允许新建清单（历史清单保留，且只有一份 active）
    r = R.createPackList([w], w.id, [{ name: "新锦盒" }]);
    assert.equal(r.ok, true);
    w = r.works[0];
    assert.equal(w.packLists.filter(p => p.status === "active").length, 1);
  }

  // 记录缺陷同样触发失效
  r = R.addDefect([w], w.id, "右侧翘线");
  assert.equal(r.ok, true);
  w = r.works[0];
  assert.equal(w.status, "待交付");
  assert.equal(w.packLists.filter(p => p.status === "voided").length, 5);
});

test("包装后修改非受保护字段不影响清单", () => {
  let w = makeWork();
  w = R.createPackList([w], w.id, [{ name: "锦盒" }]).works[0];
  const r = R.editWork([w], w.id, { note: "客户加备注", gold: "已上金粉", delivery: "2026-10-01" });
  assert.equal(r.ok, true);
  const nw = r.works[0];
  assert.equal(nw.status, "待签收");
  assert.equal(R.activeList(nw).status, "active");
});

test("存在未结束清单时不能直接改工序状态", () => {
  let w = makeWork();
  w = R.createPackList([w], w.id, [{ name: "锦盒" }]).works[0];
  const r = R.changeStatus([w], w.id, "贴线中");
  assert.equal(r.ok, false);
});

test("签收必须记录收货人、实际交付日期、唯一签收号，缺项拒绝", () => {
  let w = makeWork();
  w = R.createPackList([w], w.id, [{ name: "锦盒", qty: "2" }]).works[0];

  assert.equal(R.signoff([w], w.id, {}).ok, false);
  assert.match(R.signoff([w], w.id, { deliveredOn: "2026-09-20", receiptNo: "Q1" }).error, /收货人/);
  assert.match(R.signoff([w], w.id, { receiver: "张三", receiptNo: "Q1" }).error, /实际交付日期/);
  assert.match(R.signoff([w], w.id, { receiver: "张三", deliveredOn: "2026-09-20" }).error, /签收号/);

  const r = R.signoff([w], w.id, { receiver: "张三", deliveredOn: "2026-09-20", receiptNo: "QXD-001" });
  assert.equal(r.ok, true);
  w = r.works[0];
  assert.equal(w.status, "已签收");
  assert.equal(w.packLists[0].status, "signed");
  assert.deepEqual(R.latestReceipt(w).receiptNo, "QXD-001");

  // 无 active 清单不能再签收
  assert.equal(R.signoff([w], w.id, { receiver: "李四", deliveredOn: "2026-09-21", receiptNo: "QXD-002" }).ok, false);
});

test("签收号全工坊唯一（同一作品返工后再签收也不能复用旧号）", () => {
  let w1 = makeWork({ theme: "甲" });
  let w2 = makeWork({ theme: "乙" });
  let all = [w1, w2];
  all = R.createPackList(all, w1.id, [{ name: "盒" }]).works;
  all = R.signoff(all, w1.id, { receiver: "甲", deliveredOn: "2026-09-20", receiptNo: "DUP-1" }).works;
  all = R.createPackList(all, w2.id, [{ name: "盒" }]).works;
  const r = R.signoff(all, w2.id, { receiver: "乙", deliveredOn: "2026-09-20", receiptNo: "DUP-1" });
  assert.equal(r.ok, false);
  assert.match(r.error, /唯一/);

  // 同一件作品返工后重签，旧号同样不能复用
  let w = all.find(x => x.theme === "甲");
  all = R.startRework(all, w.id, "补漆").works;
  all = R.finishRework(all, w.id).works;
  all = R.createPackList(all, w.id, [{ name: "新盒" }]).works;
  const reuse = R.signoff(all, w.id, { receiver: "甲", deliveredOn: "2026-09-26", receiptNo: "DUP-1" });
  assert.equal(reuse.ok, false);
  const again = R.signoff(all, w.id, { receiver: "甲", deliveredOn: "2026-09-26", receiptNo: "DUP-2" });
  assert.equal(again.ok, true);
});

test("新增作品时填写的初始缺陷进入缺陷历史", () => {
  const r = R.createWork([], {
    base: "木胎", theme: "纹", line: "细线", progress: 0,
    dryDate: "2026-09-10", delivery: "2026-09-20", defect: "口沿小磕"
  });
  assert.equal(r.ok, true);
  assert.equal(r.works[0].defectHistory.length, 1);
  assert.equal(r.works[0].defectHistory[0].text, "口沿小磕");
  assert.equal(R.defectWorks(r.works).length, 1);
});

test("建议签收号按日递增且不与已有号冲突", () => {
  let all = [];
  let w = makeWork();
  all = [w];
  const n1 = R.suggestedReceiptNo(all);
  all = R.createPackList(all, w.id, [{ name: "盒" }]).works;
  all = R.signoff(all, w.id, { receiver: "甲", deliveredOn: "2026-09-20", receiptNo: n1 }).works;
  all = R.startRework(all, w.id, "补色").works;
  all = R.finishRework(all, w.id).works;
  all = R.createPackList(all, w.id, [{ name: "盒" }]).works;
  const n2 = R.suggestedReceiptNo(all);
  assert.notEqual(n1, n2);
});

test("签收后补做修复只追加返工记录，原签收与缺陷历史保留，返工后可再签收", () => {
  let w = makeWork();
  w = R.addDefect([w], w.id, "初始缺陷").works[0];
  w = R.createPackList([w], w.id, [{ name: "盒" }]).works[0];
  w = R.signoff([w], w.id, { receiver: "张三", deliveredOn: "2026-09-20", receiptNo: "QXD-A" }).works[0];

  // 已签收不能直接编辑
  assert.equal(R.editWork([w], w.id, { base: "偷改" }).ok, false);
  // 非已签收不能发起返工
  assert.equal(R.startRework([makeWork()], undefined, "x").ok, false);
  // 修复说明不能为空
  assert.equal(R.startRework([w], w.id, "  ").ok, false);

  let r = R.startRework([w], w.id, "肩部补漆");
  assert.equal(r.ok, true);
  let nw = r.works[0];
  assert.equal(nw.status, "返工中");
  assert.equal(nw.rework.length, 1);
  assert.equal(nw.rework[0].finishedAt, null);
  // 原签收与缺陷历史原样保留
  assert.equal(nw.packLists[0].signoff.receiptNo, "QXD-A");
  assert.equal(nw.defectHistory.length, 1);

  // 返工中追加缺陷挂到返工轮次
  nw = R.addDefect([nw], nw.id, "返工发现翘线").works[0];
  assert.equal(nw.defectHistory.length, 2);
  assert.equal(nw.defectHistory[1].reworkNo, nw.rework[0].id);

  // 非返工中不能完成返工
  assert.equal(R.finishRework([w], w.id).ok, false);

  nw = R.finishRework([nw], nw.id).works[0];
  assert.equal(nw.status, "待交付");
  assert.ok(nw.rework[0].finishedAt);
  // 原签收仍在
  assert.equal(R.latestReceipt(nw).receiptNo, "QXD-A");

  nw = R.createPackList([nw], nw.id, [{ name: "新锦盒" }]).works[0];
  assert.equal(nw.packLists.length, 2);
  nw = R.signoff([nw], nw.id, { receiver: "张三", deliveredOn: "2026-09-25", receiptNo: "QXD-B" }).works[0];
  assert.equal(nw.status, "已签收");
  assert.equal(R.latestReceipt(nw).receiptNo, "QXD-B");
  // 全部历史保留：两次签收、一次返工、两条缺陷
  assert.equal(nw.packLists.filter(p => p.signoff).length, 2);
  assert.equal(nw.rework.length, 1);
  assert.equal(nw.defectHistory.length, 2);
});

test("统计与列表选择器口径一致", () => {
  let all = [];
  const a = makeWork({ theme: "待阴干甲", status: "待阴干", dryDate: "2026-09-20", delivery: "2026-09-19" });
  const b = makeWork({ theme: "已签乙", status: "待交付", dryDate: "2026-09-01", delivery: "2026-09-18" });
  all = [a, b];
  all = R.createPackList(all, b.id, [{ name: "盒" }]).works;
  all = R.signoff(all, b.id, { receiver: "乙", deliveredOn: "2026-09-19", receiptNo: "S1" }).works;

  const stats = R.riskStats(all, "2026-09-20");
  assert.equal(stats.todayDry, 1);
  assert.equal(stats.activePack, 0);
  assert.equal(stats.overdueDelivery, 1); // a 到期未签收；b 已签收不计

  const recent = R.recentDeliveries(all, 10);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].signoff.receiptNo, "S1");
});

test("旧版本数据迁移：defect 字符串进入缺陷历史", () => {
  const old = [{
    id: "x1", base: "旧胎", theme: "旧纹", line: "细线", progress: 50,
    dryDate: "2026-09-01", gold: "未处理", delivery: "2026-09-10",
    status: "贴线中", note: "", defect: "老缺陷一条", logs: ["创建作品"]
  }];
  const [w] = R.normalizeAll(old);
  assert.equal(w.defectHistory.length, 1);
  assert.equal(w.defectHistory[0].text, "老缺陷一条");
  assert.deepEqual(w.packLists, []);
  assert.deepEqual(w.rework, []);
});

test("命令不可变：不修改传入数组", () => {
  const w = makeWork();
  const snapshot = JSON.stringify([w]);
  R.createPackList([w], w.id, [{ name: "盒" }]);
  assert.equal(JSON.stringify([w]), snapshot);
  R.signoff([w], w.id, { receiver: "x", deliveredOn: "2026-09-20", receiptNo: "y" });
  assert.equal(JSON.stringify([w]), snapshot);
});

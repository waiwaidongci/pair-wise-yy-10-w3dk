const test = require("node:test");
const assert = require("node:assert/strict");
const { createStore, memoryStorage } = require("../js/store.js");
const R = require("../js/rules.js");

test("store 只做 JSON 读写，往返一致（刷新后状态一致）", () => {
  const backend = memoryStorage();
  const store = createStore(backend, "zfl42Works");
  assert.equal(store.load(), null);

  let works = R.normalizeAll([{
    base: "木胎", theme: "纹样", line: "细线", progress: 100,
    dryDate: "2026-09-10", gold: "已上金粉", delivery: "2026-09-20",
    status: "待交付", note: "", defect: ""
  }]);
  let w = works[0];
  works = R.createPackList(works, w.id, [{ name: "锦盒", qty: "1" }, { name: "证书" }]).works;
  works = R.signoff(works, w.id, { receiver: "李四", deliveredOn: "2026-09-20", receiptNo: "QXD-1" }).works;
  store.save(works);

  // 模拟刷新：重新 load + 规则层归一化
  const reloaded = R.normalizeAll(store.load());
  assert.equal(reloaded.length, 1);
  const rw = reloaded[0];
  assert.equal(rw.status, "已签收");
  assert.equal(R.activeList(rw), null);
  assert.equal(R.latestReceipt(rw).receiptNo, "QXD-1");
  assert.equal(R.riskStats(reloaded, "2026-09-20").activePack, 0);
  assert.equal(R.recentDeliveries(reloaded).length, 1);
});

test("损坏的 JSON 返回 null，不抛异常", () => {
  const backend = memoryStorage({ zfl42Works: "{不是合法json" });
  const store = createStore(backend, "zfl42Works");
  assert.equal(store.load(), null);
});

test("不同 key 互相隔离", () => {
  const backend = memoryStorage();
  createStore(backend, "a").save([{ id: "1" }]);
  assert.equal(createStore(backend, "b").load(), null);
  assert.deepEqual(createStore(backend, "a").load(), [{ id: "1" }]);
});

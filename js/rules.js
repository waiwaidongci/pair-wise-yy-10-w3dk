/*
 * 规则层（纯领域逻辑）
 * 不依赖 DOM、不依赖 localStorage，只接收数据并返回结果，便于独立测试。
 * 所有规则判断集中在此层，持久化与界面展示分别由 store.js / ui.js 负责。
 */
(function (root, factory) {
  const Rules = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = Rules;
  if (root) root.Rules = Rules;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // 生产状态：作品在工坊内的流转
  const PRODUCTION_STATUSES = ["贴线中", "待阴干", "上金粉", "待交付"];
  // 交付闭环状态：由包装、签收、返工动作驱动，不允许手动改状态进入
  const CLOSED_LOOP_STATUSES = ["已包装", "已签收", "返工中"];
  const STATUSES = [...PRODUCTION_STATUSES, ...CLOSED_LOOP_STATUSES];

  // 包装后若调整这些关键字段，未结束的包装清单立即失效并退回待交付
  const KEY_FIELDS = ["base", "theme", "line", "defect", "dryDate"];
  const KEY_FIELD_LABELS = {
    base: "胎体",
    theme: "纹样",
    line: "线条",
    defect: "缺陷",
    dryDate: "阴干日期"
  };
  // 编辑作品时允许修改的字段
  const EDITABLE_FIELDS = ["base", "theme", "line", "progress", "dryDate", "gold", "defect", "delivery", "note"];

  function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }
  function now() {
    return new Date().toISOString();
  }
  function nowLocal() {
    return new Date().toLocaleString();
  }
  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }
  function log(work, text) {
    work.logs.push(`${nowLocal()} ${text}`);
  }

  // ---------- 查询 ----------
  function activePacking(work) {
    return (work.packings || []).find(p => p.status === "active") || null;
  }
  function activeRework(work) {
    return (work.reworks || []).find(r => !r.finishedAt) || null;
  }
  function latestSignoff(work) {
    const list = work.signoffs || [];
    return list.length ? list[list.length - 1] : null;
  }

  // ---------- 包装清单 ----------
  // 作品进入待交付后只能有一份未结束包装清单
  function canCreatePacking(work) {
    if (work.status !== "待交付") return { ok: false, error: "仅「待交付」作品可创建包装清单" };
    if (activePacking(work)) return { ok: false, error: "已存在未结束的包装清单，不可重复创建" };
    return { ok: true };
  }

  function createPacking(work, note) {
    const check = canCreatePacking(work);
    if (!check.ok) return check;
    const packing = {
      id: uid(),
      note: (note || "").trim(),
      status: "active", // active=未结束 / invalid=已失效 / done=已随签收结束
      createdAt: now(),
      closedAt: null,
      closeReason: ""
    };
    work.packings.push(packing);
    work.status = "已包装";
    log(work, "创建包装清单，进入已包装（待签收）");
    return { ok: true, packing };
  }

  // 未结束清单失效：标记失效并把作品退回待交付
  function invalidateActivePacking(work, reason) {
    const packing = activePacking(work);
    if (!packing) return null;
    packing.status = "invalid";
    packing.closedAt = now();
    packing.closeReason = reason;
    if (work.status === "已包装") work.status = "待交付";
    log(work, `包装清单失效（${reason}），退回待交付`);
    return packing;
  }

  function voidPacking(work, reason) {
    if (!activePacking(work)) return { ok: false, error: "当前没有未结束的包装清单" };
    const packing = invalidateActivePacking(work, (reason || "").trim() || "手动作废");
    return { ok: true, packing };
  }

  // 编辑作品：关键字段变化 → 未结束清单立即失效并退回待交付
  function editWork(work, changes) {
    const applied = {};
    for (const key of EDITABLE_FIELDS) {
      if (changes[key] !== undefined) applied[key] = changes[key];
    }
    const changedKeyFields = KEY_FIELDS.filter(key => applied[key] !== undefined && applied[key] !== work[key]);
    Object.assign(work, applied);
    let invalidated = null;
    if (changedKeyFields.length) {
      const labels = changedKeyFields.map(key => KEY_FIELD_LABELS[key]).join("、");
      invalidated = invalidateActivePacking(work, `关键字段被调整：${labels}`);
    }
    log(work, "编辑作品");
    return { ok: true, changedKeyFields, invalidated };
  }

  // ---------- 签收 ----------
  // 签收须记录收货人、实际交付日期和唯一签收号，缺项拒绝
  function validateSignoff(works, work, data) {
    if (work.status !== "已包装") return { ok: false, error: "仅「已包装」作品可签收" };
    const recipient = (data.recipient || "").trim();
    const actualDate = (data.actualDate || "").trim();
    const receiptNo = (data.receiptNo || "").trim();
    if (!recipient) return { ok: false, error: "缺少收货人，拒绝签收" };
    if (!actualDate) return { ok: false, error: "缺少实际交付日期，拒绝签收" };
    if (!receiptNo) return { ok: false, error: "缺少签收号，拒绝签收" };
    const duplicated = works.some(w => (w.signoffs || []).some(s => s.receiptNo === receiptNo));
    if (duplicated) return { ok: false, error: `签收号「${receiptNo}」已存在，签收号须唯一` };
    return { ok: true, value: { recipient, actualDate, receiptNo } };
  }

  function signoff(works, work, data) {
    const check = validateSignoff(works, work, data);
    if (!check.ok) return check;
    const packing = activePacking(work);
    if (packing) {
      packing.status = "done";
      packing.closedAt = now();
      packing.closeReason = "签收完成";
    }
    const record = { id: uid(), ...check.value, createdAt: now() };
    work.signoffs.push(record);
    work.status = "已签收";
    log(work, `签收完成：${record.recipient}，单号 ${record.receiptNo}，实际交付 ${record.actualDate}`);
    return { ok: true, record };
  }

  // ---------- 返工（签收后补做修复）----------
  // 只追加返工记录，原签收与缺陷历史保留
  function startRework(work, reason) {
    if (work.status !== "已签收") return { ok: false, error: "仅「已签收」作品可发起返工" };
    const rework = {
      id: uid(),
      reason: (reason || "").trim(),
      startedAt: now(),
      finishedAt: null,
      note: ""
    };
    work.reworks.push(rework);
    work.status = "返工中";
    log(work, `发起返工${rework.reason ? "：" + rework.reason : ""}（原签收与缺陷历史保留）`);
    return { ok: true, rework };
  }

  // 返工完成后退回待交付，可重新包装、再签收
  function finishRework(work, note) {
    if (work.status !== "返工中") return { ok: false, error: "仅「返工中」作品可完成返工" };
    const rework = activeRework(work);
    if (rework) {
      rework.finishedAt = now();
      rework.note = (note || "").trim();
    }
    work.status = "待交付";
    log(work, "完成返工，退回待交付，可重新包装签收");
    return { ok: true };
  }

  // ---------- 生产状态流转 ----------
  function updateStatus(work, status) {
    if (!PRODUCTION_STATUSES.includes(status)) {
      return { ok: false, error: "「已包装 / 已签收 / 返工中」需通过交付闭环操作流转" };
    }
    if (!PRODUCTION_STATUSES.includes(work.status)) {
      return { ok: false, error: `当前为「${work.status}」，请通过交付闭环操作流转` };
    }
    work.status = status;
    if (status === "待阴干") work.dryDate = todayStr();
    if (status === "上金粉") work.gold = "已上金粉";
    if (status === "待交付") work.progress = 100;
    log(work, `更新为 ${status}`);
    return { ok: true };
  }

  // ---------- 缺陷记录（缺陷历史保留）----------
  function recordDefect(work, text) {
    const value = (text || "").trim();
    if (!value) return { ok: false, error: "缺陷内容为空" };
    work.defectHistory.push({ at: now(), text: value });
    work.defect = work.defect ? `${work.defect}; ${value}` : value;
    // 记录缺陷属于关键字段调整，未结束清单立即失效
    const invalidated = invalidateActivePacking(work, "记录缺陷");
    log(work, `记录缺陷：${value}`);
    return { ok: true, invalidated };
  }

  // ---------- 风险统计 ----------
  function stats(works, today) {
    const t = today || todayStr();
    return {
      total: works.length,
      toSign: works.filter(w => w.status === "已包装").length,
      signed: works.filter(w => w.status === "已签收").length,
      reworking: works.filter(w => w.status === "返工中").length,
      defected: works.filter(w => w.defect).length,
      overdue: works.filter(w => w.status !== "已签收" && w.delivery && w.delivery < t).length,
      invalidatedPackings: works.reduce((n, w) => n + (w.packings || []).filter(p => p.status === "invalid").length, 0),
      reworks: works.reduce((n, w) => n + (w.reworks || []).length, 0)
    };
  }

  return {
    PRODUCTION_STATUSES,
    CLOSED_LOOP_STATUSES,
    STATUSES,
    KEY_FIELDS,
    KEY_FIELD_LABELS,
    uid,
    todayStr,
    activePacking,
    activeRework,
    latestSignoff,
    canCreatePacking,
    createPacking,
    voidPacking,
    invalidateActivePacking,
    editWork,
    validateSignoff,
    signoff,
    startRework,
    finishRework,
    updateStatus,
    recordDefect,
    stats
  };
});

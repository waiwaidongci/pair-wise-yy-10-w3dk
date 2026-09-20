/*
 * 规则层：纯函数，不含 DOM / localStorage。
 * 所有写操作都接收一份 works 数组，返回 { ok, error, works }，
 * 不修改入参（不可变更新），界面层与持久化层都只依赖这一层的判断结果。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 作品状态：四个工序状态 + 包装后、签收后、返工中
  const STATUSES = ["贴线中", "待阴干", "上金粉", "待交付", "待签收", "已签收", "返工中"];
  const PRODUCTION_STATUSES = ["贴线中", "待阴干", "上金粉", "待交付"];
  // 包装后调整这些字段，包装清单立即失效
  const PROTECTED_FIELDS = ["base", "theme", "line", "defect", "dryDate"];
  const FIELD_LABELS = {
    base: "胎体材质", theme: "纹样主题", line: "线条粗细",
    defect: "缺陷", dryDate: "阴干日期"
  };

  function pad(n) { return String(n).padStart(2, "0"); }
  function localDate(d) {
    d = d || new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function stamp() { return new Date().toLocaleString("zh-CN", { hour12: false }); }

  function genId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  // 归一化旧数据（老版本只有 defect 字符串与 logs）
  function normalizeWork(w) {
    const n = Object.assign({
      base: "", theme: "", line: "", progress: 0,
      dryDate: "", gold: "未处理", delivery: "",
      status: "贴线中", note: "",
      defectHistory: [], rework: [], packLists: [],
      logs: []
    }, w);
    if (!n.id) n.id = genId();
    if (!Array.isArray(n.defectHistory)) n.defectHistory = [];
    if (!Array.isArray(n.rework)) n.rework = [];
    if (!Array.isArray(n.packLists)) n.packLists = [];
    if (!Array.isArray(n.logs)) n.logs = [];
    if (w.defect && (!w.defectHistory || !w.defectHistory.length)) {
      n.defectHistory = [{ id: genId(), text: String(w.defect), at: "", reworkNo: null }];
    }
    n.packLists = n.packLists.map(normalizeList);
    n.rework = n.rework.map(r => Object.assign({
      id: genId(), reason: "", startedAt: "", finishedAt: null, note: ""
    }, r));
    n.defectHistory = n.defectHistory.map(d => Object.assign({
      id: genId(), text: "", at: "", reworkNo: null
    }, d));
    return n;
  }

  function normalizeList(p) {
    return Object.assign({
      id: genId(),
      status: "active", // active（未结束） | signed（已签收结束） | voided（已失效结束）
      items: [],
      packedAt: "",
      voidedAt: null, voidReason: null,
      signoff: null // { receiver, deliveredOn, receiptNo, signedAt }
    }, p);
  }

  // ---------- 查询 ----------

  function activeList(w) {
    return (w.packLists || []).find(p => p.status === "active") || null;
  }
  function latestReceipt(w) {
    for (let i = w.packLists.length - 1; i >= 0; i--) {
      const p = w.packLists[i];
      if (p.signoff) return p.signoff;
    }
    return null;
  }
  function hasReceipt(w) { return !!latestReceipt(w); }
  function allReceipts(works) {
    const out = [];
    works.forEach(w => (w.packLists || []).forEach(p => {
      if (p.signoff) out.push({ workId: w.id, listId: p.id, receiptNo: p.signoff.receiptNo });
    }));
    return out;
  }
  function receiptExists(works, no) {
    const value = String(no || "").trim();
    return allReceipts(works).some(r => r.receiptNo === value);
  }
  function suggestedReceiptNo(works) {
    const day = localDate().replace(/-/g, "");
    const prefix = `QXD-${day}-`;
    let max = 0;
    allReceipts(works).forEach(r => {
      if (r.receiptNo.startsWith(prefix)) {
        const n = Number(r.receiptNo.slice(prefix.length));
        if (Number.isInteger(n) && n > max) max = n;
      }
    });
    return prefix + pad3(max + 1);
  }
  function pad3(n) { return String(n).padStart(3, "0"); }

  // ---------- 选择器（列表、统计全部从这里派生，保证口径一致）----------

  function todayDryWorks(works, day) {
    day = day || localDate();
    return works.filter(w => w.status === "待阴干" && w.dryDate <= day);
  }
  function defectWorks(works) {
    return works.filter(w => w.defectHistory.length > 0);
  }
  // 最近交付：只取真实签收记录（保留全部签收历史，返工后再签收会产生新记录）
  function recentDeliveries(works, limit) {
    const rows = [];
    works.forEach(w => (w.packLists || []).forEach(p => {
      if (p.signoff) rows.push({ work: w, list: p, signoff: p.signoff });
    }));
    return rows
      .sort((a, b) => b.signoff.deliveredOn.localeCompare(a.signoff.deliveredOn) ||
        b.signoff.signedAt.localeCompare(a.signoff.signedAt))
      .slice(0, limit == null ? 5 : limit);
  }
  function activePackCount(works) {
    return works.filter(w => activeList(w)).length;
  }
  function voidedCount(works) {
    return works.reduce((n, w) => n + w.packLists.filter(p => p.status === "voided").length, 0);
  }
  function openDeliveryCount(works, day) {
    day = day || localDate();
    // 未签收（含返工中）且计划交付日期已到/逾期
    return works.filter(w => w.status !== "已签收" && w.delivery && w.delivery <= day).length;
  }
  function reworkCount(works) {
    return works.filter(w => w.status === "返工中").length;
  }
  function riskStats(works, day) {
    return {
      todayDry: todayDryWorks(works, day).length,
      defect: defectWorks(works).length,
      activePack: activePackCount(works),
      voided: voidedCount(works),
      rework: reworkCount(works),
      overdueDelivery: openDeliveryCount(works, day)
    };
  }

  // ---------- 命令 ----------

  function err(works, message) { return { ok: false, error: message, works: works }; }
  function ok(works, logTarget) { return { ok: true, error: null, works: works, work: logTarget || null }; }
  function withWork(works, id, fn) {
    const idx = works.findIndex(w => w.id === id);
    if (idx < 0) return { error: "作品不存在" };
    const copy = clone(works);
    const result = fn(copy[idx], copy);
    return { list: copy, idx, result };
  }

  function createWork(works, input) {
    const data = input || {};
    if (!String(data.base || "").trim()) return err(works, "胎体材质为必填项");
    if (!String(data.theme || "").trim()) return err(works, "纹样主题为必填项");
    if (!data.dryDate) return err(works, "阴干日期为必填项");
    if (!data.delivery) return err(works, "交付日期为必填项");
    const w = normalizeWork({
      id: genId(),
      base: String(data.base).trim(),
      theme: String(data.theme).trim(),
      line: data.line || "细线",
      progress: Number(data.progress) || 0,
      dryDate: data.dryDate,
      gold: data.gold || "未处理",
      delivery: data.delivery,
      status: PRODUCTION_STATUSES.includes(data.status) ? data.status : "贴线中",
      note: String(data.note || "").trim()
    });
    const initialDefect = String(data.defect || "").trim();
    if (initialDefect) {
      w.defectHistory.push({ id: genId(), text: initialDefect, at: stamp(), reworkNo: null });
      w.defect = initialDefect;
    }
    w.logs.push(`${stamp()} 创建作品`);
    return ok([w].concat(clone(works)), w);
  }

  // 工序状态流转：存在未结束包装清单或已离开工序段时拒绝
  function changeStatus(works, id, next) {
    if (!PRODUCTION_STATUSES.includes(next)) {
      return err(works, "工序状态只能是贴线中、待阴干、上金粉、待交付");
    }
    const r = withWork(works, id, w => {
      if (activeList(w)) return "作品已有未结束的包装清单，不能直接改工序状态";
      if (!PRODUCTION_STATUSES.includes(w.status)) {
        return "已进入交付/返工环节，不能直接改回工序状态";
      }
      if (w.status === next) return "";
      w.status = next;
      if (next === "待阴干") w.dryDate = localDate();
      if (next === "上金粉") w.gold = "已上金粉";
      if (next === "待交付") w.progress = 100;
      w.logs.push(`${stamp()} 更新为 ${next}`);
      return "";
    });
    if (r.error) return err(works, r.error);
    if (r.result) return err(works, r.result);
    return ok(r.list, r.list[r.idx]);
  }

  // 创建包装清单：只有“待交付”可建，且只能有一份未结束清单
  function createPackList(works, id, items) {
    const clean = (items || [])
      .map(it => ({ name: String((it && it.name) || "").trim(), qty: String((it && it.qty) || "").trim() }))
      .filter(it => it.name);
    if (!clean.length) return err(works, "包装清单至少需要一项包装内容");
    const r = withWork(works, id, w => {
      if (activeList(w)) return "该作品已有一份未结束的包装清单";
      if (w.status !== "待交付") return "只有待交付的作品才能建立包装清单";
      w.packLists.push(normalizeList({
        items: clean, packedAt: stamp(), status: "active"
      }));
      w.status = "待签收";
      w.progress = 100;
      w.logs.push(`${stamp()} 建立包装清单（${clean.length} 项），进入待签收`);
      return "";
    });
    if (r.error) return err(works, r.error);
    if (r.result) return err(works, r.result);
    return ok(r.list, r.list[r.idx]);
  }

  // 调整作品资料。包装后修改受保护字段 -> 清单失效、退回待交付
  function editWork(works, id, patch) {
    patch = patch || {};
    const changed = {};
    const r = withWork(works, id, (w, list) => {
      // 已签收作品不能直接改，必须先走补做修复（返工）
      if (w.status === "已签收") return "已签收作品不能直接调整，请先发起补做修复";
      ["base", "theme", "line", "note", "gold", "dryDate", "delivery", "progress"].forEach(k => {
        if (patch[k] !== undefined && String(patch[k]) !== String(w[k])) changed[k] = true;
      });
      const act = activeList(w);
      const touched = PROTECTED_FIELDS.filter(k => changed[k]);
      if (act && touched.length) {
        act.status = "voided";
        act.voidedAt = stamp();
        act.voidReason = "调整" + touched.map(k => FIELD_LABELS[k]).join("、") + "，清单自动失效";
        w.status = "待交付";
        touched.forEach(k => { w[k] = patch[k]; });
        w.logs.push(
          `${stamp()} 调整${touched.map(k => FIELD_LABELS[k]).join("、")}，包装清单 ${act.id.slice(0, 8)} 失效，退回待交付`
        );
        return "";
      }
      Object.keys(changed).forEach(k => { w[k] = patch[k]; });
      if (changed.progress) w.progress = Number(w.progress) || 0;
      if (Object.keys(changed).length) {
        w.logs.push(`${stamp()} 编辑资料：${Object.keys(changed).map(k => FIELD_LABELS[k] || k).join("、")}`);
      }
      return "";
    });
    if (r.error) return err(works, r.error);
    if (r.result) return err(works, r.result);
    return ok(r.list, r.list[r.idx]);
  }

  // 记录缺陷：任何状态都只能追加，签收后追加会挂到当前返工轮次（若处于返工中）
  function addDefect(works, id, text) {
    const value = String(text || "").trim();
    if (!value) return err(works, "缺陷描述不能为空");
    const r = withWork(works, id, w => {
      const reworkNo = w.status === "返工中" && w.rework.length
        ? w.rework[w.rework.length - 1].id
        : null;
      w.defectHistory.push({ id: genId(), text: value, at: stamp(), reworkNo: reworkNo });
      // 兼容旧视图的当前缺陷摘要字段
      w.defect = w.defectHistory.map(d => d.text).join("; ");
      if (activeList(w)) {
        const p = activeList(w);
        p.status = "voided";
        p.voidedAt = stamp();
        p.voidReason = "记录新缺陷，清单自动失效";
        w.status = "待交付";
        w.logs.push(`${stamp()} 缺陷：${value}；包装清单 ${p.id.slice(0, 8)} 失效，退回待交付`);
      } else {
        w.logs.push(`${stamp()} 缺陷：${value}`);
      }
      return "";
    });
    if (r.error) return err(works, r.error);
    if (r.result) return err(works, r.result);
    return ok(r.list, r.list[r.idx]);
  }

  // 签收：收货人、实际交付日期、唯一签收号缺一不可
  function signoff(works, id, info) {
    info = info || {};
    const receiver = String(info.receiver || "").trim();
    const deliveredOn = String(info.deliveredOn || "").trim();
    const receiptNo = String(info.receiptNo || "").trim();
    const missing = [];
    if (!receiver) missing.push("收货人");
    if (!deliveredOn) missing.push("实际交付日期");
    if (!receiptNo) missing.push("签收号");
    if (missing.length) return err(works, `缺少${missing.join("、")}，拒绝签收`);

    const r = withWork(works, id, (w, list) => {
      const p = activeList(w);
      if (!p) return "没有未结束的包装清单，不能签收";
      if (receiptExists(list, receiptNo)) return "签收号已被使用，必须全工坊唯一";
      p.status = "signed";
      p.signoff = { receiver, deliveredOn, receiptNo, signedAt: stamp() };
      w.status = "已签收";
      w.logs.push(`${stamp()} 签收：${receiver} / ${deliveredOn} / ${receiptNo}`);
      return "";
    });
    if (r.error) return err(works, r.error);
    if (r.result) return err(works, r.result);
    return ok(r.list, r.list[r.idx]);
  }

  // 签收后补做修复：只追加返工记录，原签收与缺陷历史保留
  function startRework(works, id, reason) {
    const value = String(reason || "").trim();
    if (!value) return err(works, "修复说明不能为空");
    const r = withWork(works, id, w => {
      if (w.status !== "已签收") return "只有已签收的作品才能发起补做修复";
      w.rework.push({ id: genId(), reason: value, startedAt: stamp(), finishedAt: null, note: "" });
      w.status = "返工中";
      w.logs.push(`${stamp()} 签收后补做修复：${value}（原签收记录保留）`);
      return "";
    });
    if (r.error) return err(works, r.error);
    if (r.result) return err(works, r.result);
    return ok(r.list, r.list[r.idx]);
  }

  function finishRework(works, id) {
    const r = withWork(works, id, w => {
      if (w.status !== "返工中") return "只有返工中的作品才能完成返工";
      const rw = w.rework[w.rework.length - 1];
      rw.finishedAt = stamp();
      w.status = "待交付";
      w.logs.push(`${stamp()} 返工完成，回到待交付，可重新包装签收`);
      return "";
    });
    if (r.error) return err(works, r.error);
    if (r.result) return err(works, r.result);
    return ok(r.list, r.list[r.idx]);
  }

  function normalizeAll(works) {
    return (works || []).map(normalizeWork);
  }

  return {
    STATUSES, PRODUCTION_STATUSES, PROTECTED_FIELDS, FIELD_LABELS,
    localDate, stamp, genId, normalizeWork, normalizeList, normalizeAll,
    activeList, latestReceipt, hasReceipt, allReceipts, receiptExists, suggestedReceiptNo,
    todayDryWorks, defectWorks, recentDeliveries,
    activePackCount, voidedCount, openDeliveryCount, reworkCount, riskStats,
    createWork, changeStatus, createPackList, editWork, addDefect,
    signoff, startRework, finishRework
  };
});

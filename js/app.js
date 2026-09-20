/*
 * 界面层：只负责 DOM 交互与展示。
 * 所有判断都调用 Rules 的纯函数；每次命令成功后由 commit() 统一
 * “改内存 -> 持久化 -> 重绘”，因此列表、风险统计与刷新后状态始终一致。
 */
(function () {
  "use strict";

  const { createStore, memoryStorage } = window.Store;
  const R = window.Rules;
  const storage = (function () {
    try {
      if (typeof localStorage !== "undefined") return localStorage;
    } catch (e) { /* 隐私模式等场景退回内存存储 */ }
    return memoryStorage();
  })();
  const store = createStore(storage, "zfl42Works");

  const today = R.localDate();

  function seedData() {
    return [
      { base: "木胎香盒", theme: "海水江崖", line: "细线", progress: 70, dryDate: today, gold: "未处理", delivery: R.localDate(new Date(Date.now() + 6 * 86400000)), status: "待阴干", note: "边线需保持低浮雕感" },
      { base: "脱胎盘", theme: "折枝梅", line: "混合线", progress: 95, dryDate: "2026-09-15", gold: "试扫粉", defect: "左侧枝干翘线", delivery: R.localDate(new Date(Date.now() + 3 * 86400000)), status: "上金粉", note: "客户要求金粉偏暗" },
      { base: "竹胎笔筒", theme: "云雷纹", line: "中线", progress: 40, dryDate: "2026-09-24", gold: "未处理", delivery: "2026-09-30", status: "贴线中", note: "" },
      { base: "脱胎漆瓶", theme: "缠枝莲", line: "中线", progress: 100, dryDate: "2026-09-18", gold: "已上金粉", delivery: today, status: "待交付", note: "已贴金签待包装" }
    ];
  }

  // 载入后统一交给规则层归一化，老版本数据自动迁移
  let works = R.normalizeAll(store.load() || seedData());
  let activeId = null;

  const $ = sel => document.querySelector(sel);
  const form = $("#workForm");
  const board = $("#board");
  const statusFilter = $("#statusFilter");
  const themeFilter = $("#themeFilter");
  const sortMode = $("#sortMode");
  const detailDialog = $("#detailDialog");
  const packDialog = $("#packDialog");
  const signDialog = $("#signDialog");
  const reworkDialog = $("#reworkDialog");
  const editDialog = $("#editDialog");

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, s => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[s]));
  }

  function toast(msg, okFlag) {
    const el = $("#toast");
    el.textContent = msg;
    el.className = "toast show " + (okFlag ? "ok" : "err");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2600);
  }

  // 唯一提交口：规则层返回结果 -> 持久化 -> 重绘
  function commit(result, successMsg) {
    if (!result.ok) { toast(result.error, false); return false; }
    works = result.works;
    store.save(works);
    render();
    if (successMsg) toast(successMsg, true);
    return true;
  }

  // ---------- 动作 ----------

  function act(id, fn) {
    const w = works.find(x => x.id === id);
    if (!w) return toast("作品不存在", false);
    fn(w);
  }

  function openPack(id) {
    act(id, w => {
      activeId = id;
      $("#packItems").innerHTML = "";
      addPackRow();
      $("#packWarn").classList.add("hidden");
      packDialog.showModal();
    });
  }

  function addPackRow() {
    const div = document.createElement("div");
    div.className = "pack-row";
    div.innerHTML = `
      <input class="pack-name" placeholder="包装内容，如锦盒/防潮纸/证书">
      <input class="pack-qty" placeholder="数量">
      <button type="button" class="secondary small" data-act="remove">删</button>`;
    $("#packItems").appendChild(div);
  }

  function submitPack() {
    const items = [...document.querySelectorAll("#packItems .pack-row")].map(row => ({
      name: row.querySelector(".pack-name").value,
      qty: row.querySelector(".pack-qty").value
    }));
    if (commit(R.createPackList(works, activeId, items), "包装清单已建立，进入待签收")) {
      packDialog.close();
    }
  }

  function openSign(id) {
    act(id, w => {
      activeId = id;
      $("#signReceiver").value = "";
      $("#signDate").value = today;
      const input = $("#signReceipt");
      input.value = "";
      input.placeholder = "建议签收号 " + R.suggestedReceiptNo(works);
      $("#signError").textContent = "";
      const items = R.activeList(w) ? R.activeList(w).items : [];
      $("#signPackSummary").innerHTML = items.length
        ? items.map(it => `<li>${esc(it.name)}${it.qty ? " × " + esc(it.qty) : ""}</li>`).join("")
        : "<li>无清单</li>";
      signDialog.showModal();
    });
  }

  function submitSign() {
    const result = R.signoff(works, activeId, {
      receiver: $("#signReceiver").value,
      deliveredOn: $("#signDate").value,
      receiptNo: $("#signReceipt").value
    });
    if (!result.ok) { $("#signError").textContent = result.error; toast(result.error, false); return; }
    signDialog.close();
    commit(result, "签收完成");
  }

  function openRework(id) {
    act(id, () => {
      activeId = id;
      $("#reworkReason").value = "";
      $("#reworkError").textContent = "";
      reworkDialog.showModal();
    });
  }

  function submitRework() {
    const result = R.startRework(works, activeId, $("#reworkReason").value);
    if (!result.ok) { $("#reworkError").textContent = result.error; toast(result.error, false); return; }
    reworkDialog.close();
    commit(result, "已登记补做修复，原签收与缺陷历史保留");
  }

  function openEdit(id) {
    act(id, w => {
      activeId = id;
      const f = $("#editForm");
      f.elements.base.value = w.base; f.elements.theme.value = w.theme; f.elements.line.value = w.line;
      f.elements.dryDate.value = w.dryDate; f.elements.delivery.value = w.delivery;
      f.elements.progress.value = w.progress; f.elements.gold.value = w.gold; f.elements.note.value = w.note;
      const warn = $("#editWarn");
      if (R.activeList(w)) {
        warn.textContent = "该作品已有未结束包装清单：修改胎体、纹样、线条、阴干日期将使清单立即失效并退回待交付（保存缺陷请用“记缺陷”）。";
        warn.classList.remove("hidden");
      } else {
        warn.classList.add("hidden");
      }
      if (w.status === "已签收") {
        warn.textContent = "已签收作品不能直接调整，请关闭后使用“补做修复”。";
        warn.classList.remove("hidden");
      }
      editDialog.showModal();
    });
  }

  function submitEdit() {
    const f = $("#editForm");
    const e = f.elements;
    const patch = {
      base: e.base.value.trim(), theme: e.theme.value.trim(), line: e.line.value,
      dryDate: e.dryDate.value, delivery: e.delivery.value,
      progress: Number(e.progress.value), gold: e.gold.value, note: e.note.value.trim()
    };
    if (!patch.base || !patch.theme || !patch.dryDate || !patch.delivery) {
      return toast("胎体、纹样、阴干日期、交付日期不可为空", false);
    }
    const w = works.find(x => x.id === activeId);
    const willVoid = R.activeList(w) && R.PROTECTED_FIELDS
      .some(k => ["base", "theme", "line", "dryDate"].includes(k) && String(patch[k]) !== String(w[k]));
    if (commit(R.editWork(works, activeId, patch), willVoid ? "清单已失效，作品退回待交付" : "资料已更新")) {
      editDialog.close();
      if (activeId && detailDialog.open) refreshDetail();
    }
  }

  // ---------- 详情 ----------

  function historyList(w) {
    const packs = (w.packLists || []).map((p, i) => {
      const tag = p.status === "active" ? `<span class="tag tag-active">未结束</span>`
        : p.status === "signed" ? `<span class="tag tag-signed">已签收</span>`
        : `<span class="tag tag-voided">已失效</span>`;
      const sign = p.signoff
        ? `<div class="meta">签收：${esc(p.signoff.receiver)} · ${esc(p.signoff.deliveredOn)} · <b>${esc(p.signoff.receiptNo)}</b></div>`
        : "";
      const voidInfo = p.voidReason ? `<div class="meta void-reason">失效原因：${esc(p.voidReason)}（${esc(p.voidedAt)}）</div>` : "";
      return `<div class="hist">包装清单 #${i + 1} ${tag}
        <ul class="kv">${p.items.map(it => `<li>${esc(it.name)}${it.qty ? " × " + esc(it.qty) : ""}</li>`).join("")}</ul>
        <div class="meta">建立：${esc(p.packedAt)}</div>${sign}${voidInfo}</div>`;
    }).join("");

    const reworks = (w.rework || []).map((r, i) => `<div class="hist">返工 #${i + 1}
      <div class="meta">${esc(r.reason)}</div>
      <div class="meta">开始：${esc(r.startedAt)}${r.finishedAt ? " · 完成：" + esc(r.finishedAt) : " · 进行中"}</div></div>`).join("");

    const defects = (w.defectHistory || []).map(d =>
      `<li>${esc(d.text)} <span class="meta">${esc(d.at || "历史记录")}${d.reworkNo ? "（返工中追加）" : ""}</span></li>`).join("");

    return `
      <div class="hist-block"><h4>包装清单（仅一份可未结束）</h4>${packs || '<div class="empty">尚无包装清单</div>'}</div>
      <div class="hist-block"><h4>返工记录（只追加，不改原签收）</h4>${reworks || '<div class="empty">无返工</div>'}</div>
      <div class="hist-block"><h4>缺陷历史（全程保留）</h4><ul class="kv">${defects || '<li>无</li>'}</ul></div>`;
  }

  function refreshDetail() {
    const w = works.find(x => x.id === activeId);
    if (!w) return detailDialog.close();
    $("#detailTitle").textContent = `${w.theme} · ${w.base}`;
    const receipt = R.latestReceipt(w);
    $("#detailContent").innerHTML = `
      <div class="kv-grid">
        <span>胎体材质</span><b>${esc(w.base)}</b>
        <span>线条粗细</span><b>${esc(w.line)}</b>
        <span>贴线进度</span><b>${esc(w.progress)}%</b>
        <span>阴干日期</span><b>${esc(w.dryDate)}</b>
        <span>金粉状态</span><b>${esc(w.gold)}</b>
        <span>计划交付</span><b>${esc(w.delivery)}</b>
        <span>当前状态</span><b class="status-pill">${esc(w.status)}</b>
        <span>备注</span><b>${esc(w.note || "无")}</b>
      </div>
      ${receipt ? `<div class="receipt-box">最近签收：${esc(receipt.receiver)} · ${esc(receipt.deliveredOn)} · <b>${esc(receipt.receiptNo)}</b></div>` : ""}
      ${historyList(w)}
      <div class="hist-block"><h4>流转记录</h4><div class="meta logs">${w.logs.map(esc).join("<br>")}</div></div>`;
    $("#defectInput").value = "";
  }

  function showDetail(id) {
    activeId = id;
    refreshDetail();
    detailDialog.showModal();
  }

  // ---------- 渲染 ----------

  function filtered() {
    return works
      .filter(w => !statusFilter.value || w.status === statusFilter.value)
      .filter(w => !themeFilter.value || w.theme.includes(themeFilter.value.trim()))
      .slice()
      .sort((a, b) => (a[sortMode.value] || "").localeCompare(b[sortMode.value] || ""));
  }

  function cardActions(w) {
    const buttons = [];
    const list = R.activeList(w);
    if (list) {
      if (w.status === "待签收") {
        buttons.push(btn("签收", "violet", `openSign('${w.id}')`));
      }
      buttons.push(btn("记缺陷", "warn", `promptDefect('${w.id}')`));
    } else if (R.PRODUCTION_STATUSES.includes(w.status)) {
      R.PRODUCTION_STATUSES.forEach(s => {
        if (s !== w.status) buttons.push(btn(s, "secondary", `updateStatus('${w.id}','${s}')`));
      });
      buttons.push(btn("记缺陷", "warn", `promptDefect('${w.id}')`));
      if (w.status === "待交付") buttons.push(btn("建立包装", "violet", `openPack('${w.id}')`));
    } else if (w.status === "已签收") {
      buttons.push(btn("补做修复", "danger", `openRework('${w.id}')`));
    } else if (w.status === "返工中") {
      buttons.push(btn("返工完成", "secondary", `finishRework('${w.id}')`));
      buttons.push(btn("记缺陷", "warn", `promptDefect('${w.id}')`));
    }
    buttons.push(btn("编辑", "secondary", `openEdit('${w.id}')`));
    return buttons.join("");
  }

  function btn(label, cls, handler) {
    return `<button class="${cls}" onclick="${handler}">${label}</button>`;
  }

  function packLine(w) {
    const list = R.activeList(w);
    if (list) {
      return `<div class="meta pack-line">📦 包装中（${list.items.length} 项，未签收）</div>`;
    }
    const receipt = R.latestReceipt(w);
    if (receipt) {
      return `<div class="meta pack-line">✅ 已签收 ${esc(receipt.receiptNo)}<br>${esc(receipt.receiver)} · ${esc(receipt.deliveredOn)}</div>`;
    }
    return "";
  }

  function renderBoard() {
    const list = filtered();
    board.innerHTML = R.STATUSES.map(status => {
      const cards = list.filter(w => w.status === status);
      return `<section class="col">
        <h3><span>${status}</span><span>${cards.length}</span></h3>
        ${cards.length ? cards.map(w => `<article class="item ${w.defectHistory.length ? "overdue" : ""} ${R.activeList(w) ? "packed" : ""}" onclick="showDetail('${w.id}')">
          <b>${esc(w.theme)}</b>
          <div class="meta">${esc(w.base)} · ${esc(w.line)}<br>进度 ${esc(w.progress)}% · 阴干 ${esc(w.dryDate)}<br>金粉：${esc(w.gold)} · 交付：${esc(w.delivery)}<br>缺陷：${w.defectHistory.length ? esc(w.defectHistory.map(d => d.text).join("; ")) : "无"}</div>
          ${packLine(w)}
          <div class="actions" onclick="event.stopPropagation()">${cardActions(w)}</div>
        </article>`).join("") : `<div class="empty">暂无作品</div>`}
      </section>`;
    }).join("");
  }

  function renderSummaries() {
    const rows = R.recentDeliveries(works, 4);
    $("#todayDry").innerHTML = R.todayDryWorks(works, today).length
      ? R.todayDryWorks(works, today).map(w =>
        `<div class="item" onclick="showDetail('${w.id}')"><b>${esc(w.theme)}</b><div class="meta">${esc(w.base)} · ${esc(w.dryDate)}</div></div>`).join("")
      : `<div class="empty">暂无</div>`;
    $("#defectList").innerHTML = R.defectWorks(works).length
      ? R.defectWorks(works).map(w =>
        `<div class="item overdue" onclick="showDetail('${w.id}')"><b>${esc(w.theme)}</b><div class="meta">${esc(w.defectHistory.map(d => d.text).join("; "))}</div></div>`).join("")
      : `<div class="empty">暂无</div>`;
    $("#deliveryList").innerHTML = rows.length
      ? rows.map(r =>
        `<div class="item signed" onclick="showDetail('${r.work.id}')"><b>${esc(r.work.theme)}</b><div class="meta">${esc(r.signoff.deliveredOn)} · ${esc(r.signoff.receiver)}<br>单号 ${esc(r.signoff.receiptNo)}</div></div>`).join("")
      : `<div class="empty">尚无签收</div>`;

    const s = R.riskStats(works, today);
    $("#riskChips").innerHTML = `
      <span class="chip chip-red">今日待阴干 ${s.todayDry}</span>
      <span class="chip chip-red">在途缺陷 ${s.defect}</span>
      <span class="chip chip-amber">未结束包装 ${s.activePack}</span>
      <span class="chip chip-red">已失效清单 ${s.voided}</span>
      <span class="chip chip-violet">返工中 ${s.rework}</span>
      <span class="chip ${s.overdueDelivery ? "chip-red" : ""}">到期未签收 ${s.overdueDelivery}</span>`;
  }

  function render() {
    renderSummaries();
    renderBoard();
  }

  // ---------- 事件绑定 ----------

  form.addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (commit(R.createWork(works, data), "作品已加入工坊")) {
      form.reset();
      form.elements.dryDate.value = today;
      form.elements.delivery.value = R.localDate(new Date(Date.now() + 5 * 86400000));
    }
  });

  $("#saveDefect").addEventListener("click", () => {
    const text = $("#defectInput").value.trim();
    if (commit(R.addDefect(works, activeId, text), "缺陷已记录")) refreshDetail();
  });
  $("#addPackRow").addEventListener("click", addPackRow);
  $("#packItems").addEventListener("click", e => {
    if (e.target.dataset.act === "remove") e.target.closest(".pack-row").remove();
  });
  $("#submitPack").addEventListener("click", submitPack);
  $("#submitSign").addEventListener("click", submitSign);
  $("#submitRework").addEventListener("click", submitRework);
  $("#submitEdit").addEventListener("click", submitEdit);
  $("#closeDetail").addEventListener("click", () => detailDialog.close());
  $("#cancelPack").addEventListener("click", () => packDialog.close());
  $("#cancelSign").addEventListener("click", () => signDialog.close());
  $("#cancelRework").addEventListener("click", () => reworkDialog.close());
  $("#cancelEdit").addEventListener("click", () => editDialog.close());

  $("#clearFilters").addEventListener("click", () => {
    themeFilter.value = "";
    statusFilter.value = "";
    render();
  });
  [statusFilter, themeFilter, sortMode].forEach(el => el.addEventListener("input", render));

  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(works, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "lacquer-thread-works.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  // 暴露给内联事件（仅动作入口，规则仍在 Rules 内）
  window.updateStatus = (id, status) => commit(R.changeStatus(works, id, status), "状态已更新");
  window.promptDefect = id => {
    activeId = id;
    const text = prompt("输入断线/翘线位置");
    if (text && text.trim()) {
      const w = works.find(x => x.id === id);
      const voided = !!R.activeList(w);
      if (commit(R.addDefect(works, id, text.trim()), voided ? "缺陷已记录，清单失效并退回待交付" : "缺陷已记录")) {
        if (detailDialog.open) refreshDetail();
      }
    }
  };
  window.finishRework = id => {
    if (commit(R.finishRework(works, id), "返工完成，可重新包装签收") && detailDialog.open) refreshDetail();
  };
  window.showDetail = showDetail;
  window.openPack = openPack;
  window.openSign = openSign;
  window.openRework = openRework;
  window.openEdit = openEdit;

  // 初始化
  form.elements.dryDate.value = today;
  form.elements.delivery.value = R.localDate(new Date(Date.now() + 5 * 86400000));
  statusFilter.innerHTML = `<option value="">全部状态</option>` +
    R.STATUSES.map(s => `<option>${s}</option>`).join("");
  store.save(works);
  render();
})();

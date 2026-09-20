/*
 * 界面层
 * 只负责 DOM 渲染与事件处理：调用规则层（Rules）做判断，调用持久化层（Store）保存，
 * 然后整体重新渲染，保证列表、风险统计与刷新后的状态一致。
 */
(function () {
  "use strict";

  const today = Rules.todayStr();
  const STATUSES = Rules.STATUSES;
  const PRODUCTION = Rules.PRODUCTION_STATUSES;

  // ---------- 初始数据（仅首次使用时写入）----------
  function seed() {
    const base = { logs: [], defectHistory: [], packings: [], signoffs: [], reworks: [] };
    return [
      {
        ...base,
        id: Rules.uid(),
        base: "木胎香盒",
        theme: "海水江崖",
        line: "细线",
        progress: 70,
        dryDate: today,
        gold: "未处理",
        defect: "",
        delivery: "2026-09-26",
        status: "待阴干",
        note: "边线需保持低浮雕感",
        logs: [`${new Date().toLocaleString()} 创建作品`]
      },
      {
        ...base,
        id: Rules.uid(),
        base: "脱胎盘",
        theme: "折枝梅",
        line: "混合线",
        progress: 95,
        dryDate: "2026-09-18",
        gold: "试扫粉",
        defect: "左侧枝干翘线",
        delivery: "2026-09-23",
        status: "上金粉",
        note: "客户要求金粉偏暗",
        defectHistory: [{ at: new Date().toISOString(), text: "左侧枝干翘线" }],
        logs: [`${new Date().toLocaleString()} 创建作品`, `${new Date().toLocaleString()} 记录翘线`]
      },
      {
        ...base,
        id: Rules.uid(),
        base: "竹胎笔筒",
        theme: "云雷纹",
        line: "中线",
        progress: 40,
        dryDate: "2026-09-24",
        gold: "未处理",
        defect: "",
        delivery: "2026-09-30",
        status: "贴线中",
        note: "",
        logs: [`${new Date().toLocaleString()} 创建作品`]
      },
      {
        ...base,
        id: Rules.uid(),
        base: "脱胎佛像",
        theme: "宝相花",
        line: "粗线",
        progress: 100,
        dryDate: "2026-09-15",
        gold: "已上金粉",
        defect: "",
        delivery: "2026-09-28",
        status: "待交付",
        note: "待包装交付",
        logs: [`${new Date().toLocaleString()} 创建作品`]
      }
    ];
  }

  let works = Store.load() || seed();
  let activeId = null;

  // ---------- DOM 引用 ----------
  const form = document.querySelector("#workForm");
  const board = document.querySelector("#board");
  const statusFilter = document.querySelector("#statusFilter");
  const themeFilter = document.querySelector("#themeFilter");
  const sortMode = document.querySelector("#sortMode");
  const statsBar = document.querySelector("#statsBar");
  const detailDialog = document.querySelector("#detailDialog");
  const detailTitle = document.querySelector("#detailTitle");
  const detailContent = document.querySelector("#detailContent");
  const detailActions = document.querySelector("#detailActions");
  const defectInput = document.querySelector("#defectInput");
  const editDialog = document.querySelector("#editDialog");
  const editForm = document.querySelector("#editForm");
  const signoffDialog = document.querySelector("#signoffDialog");
  const signoffForm = document.querySelector("#signoffForm");
  const signoffWork = document.querySelector("#signoffWork");
  const signoffError = document.querySelector("#signoffError");
  const toast = document.querySelector("#toast");

  // ---------- 初始化 ----------
  field(form, "dryDate").value = today;
  field(form, "delivery").value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  statusFilter.innerHTML =
    `<option value="">全部状态</option>` + STATUSES.map(s => `<option>${s}</option>`).join("");

  // ---------- 工具 ----------
  // 通过 name 读取表单字段（form.elements.namedItem 在各环境表现一致）
  function field(f, name) {
    return f.elements.namedItem(name);
  }
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  }
  function findWork(id) {
    return works.find(w => w.id === id);
  }
  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? esc(iso) : d.toLocaleString();
  }

  let toastTimer = null;
  function showToast(message, isError) {
    toast.textContent = message;
    toast.className = "show" + (isError ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.className = "";
    }, 2800);
  }

  // 应用规则结果：失败则提示，成功则保存并重渲染（含详情弹窗刷新）
  function applyResult(result) {
    if (!result || result.ok === false) {
      showToast((result && result.error) || "操作被拒绝", true);
      return false;
    }
    Store.save(works);
    render();
    if (detailDialog.open && activeId) showDetail(activeId);
    return true;
  }

  // ---------- 动作 ----------
  function handleAction(action, id, status) {
    const work = findWork(id);
    if (!work) return;
    switch (action) {
      case "status": {
        if (applyResult(Rules.updateStatus(work, status))) showToast(`已更新为 ${status}`);
        break;
      }
      case "defect": {
        const value = prompt("输入断线/翘线位置");
        if (value === null) return;
        const r = Rules.recordDefect(work, value);
        if (applyResult(r)) {
          showToast(r.invalidated ? "已记录缺陷，未结束包装清单已失效并退回待交付" : "已记录缺陷", !!r.invalidated);
        }
        break;
      }
      case "pack": {
        const note = prompt("包装清单备注（可选）", "");
        if (note === null) return;
        if (applyResult(Rules.createPacking(work, note))) showToast("已创建包装清单，作品进入已包装（待签收）");
        break;
      }
      case "void": {
        const reason = prompt("作废原因（可选）", "手动作废");
        if (reason === null) return;
        if (applyResult(Rules.voidPacking(work, reason))) showToast("包装清单已作废，退回待交付");
        break;
      }
      case "signoff":
        openSignoff(id);
        break;
      case "rework": {
        const reason = prompt("返工原因（可选）", "");
        if (reason === null) return;
        if (applyResult(Rules.startRework(work, reason))) showToast("已追加返工记录，原签收与缺陷历史保留");
        break;
      }
      case "finishRework": {
        const note = prompt("返工说明（可选）", "");
        if (note === null) return;
        if (applyResult(Rules.finishRework(work, note))) showToast("返工完成，退回待交付，可重新包装签收");
        break;
      }
      case "edit":
        openEdit(id);
        break;
    }
  }

  // ---------- 签收 ----------
  function suggestReceiptNo() {
    const stamp = today.replace(/-/g, "");
    let no;
    do {
      no = `QS-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    } while (works.some(w => w.signoffs.some(s => s.receiptNo === no)));
    return no;
  }

  function openSignoff(id) {
    const work = findWork(id);
    if (!work) return;
    activeId = id;
    signoffWork.textContent = `${work.theme} · ${work.base}（计划交付 ${work.delivery}）`;
    field(signoffForm, "recipient").value = "";
    field(signoffForm, "actualDate").value = today;
    field(signoffForm, "receiptNo").value = suggestReceiptNo();
    signoffError.textContent = "";
    signoffDialog.showModal();
  }

  signoffForm.addEventListener("submit", event => {
    event.preventDefault();
    const work = findWork(activeId);
    if (!work) return;
    const result = Rules.signoff(works, work, {
      recipient: field(signoffForm, "recipient").value,
      actualDate: field(signoffForm, "actualDate").value,
      receiptNo: field(signoffForm, "receiptNo").value
    });
    if (!result.ok) {
      signoffError.textContent = result.error;
      return;
    }
    Store.save(works);
    render();
    signoffDialog.close();
    if (detailDialog.open && activeId) showDetail(activeId);
    showToast(`签收完成，单号 ${result.record.receiptNo}`);
  });
  document.querySelector("#cancelSignoff").addEventListener("click", () => signoffDialog.close());

  // ---------- 编辑 ----------
  function openEdit(id) {
    const work = findWork(id);
    if (!work) return;
    activeId = id;
    field(editForm, "base").value = work.base;
    field(editForm, "theme").value = work.theme;
    field(editForm, "line").value = work.line;
    field(editForm, "progress").value = work.progress;
    field(editForm, "dryDate").value = work.dryDate;
    field(editForm, "gold").value = work.gold;
    field(editForm, "defect").value = work.defect;
    field(editForm, "delivery").value = work.delivery;
    field(editForm, "note").value = work.note;
    editDialog.showModal();
  }

  editForm.addEventListener("submit", event => {
    event.preventDefault();
    const work = findWork(activeId);
    if (!work) return;
    const result = Rules.editWork(work, {
      base: field(editForm, "base").value.trim(),
      theme: field(editForm, "theme").value.trim(),
      line: field(editForm, "line").value,
      progress: Number(field(editForm, "progress").value),
      dryDate: field(editForm, "dryDate").value,
      gold: field(editForm, "gold").value,
      defect: field(editForm, "defect").value.trim(),
      delivery: field(editForm, "delivery").value,
      note: field(editForm, "note").value
    });
    Store.save(works);
    render();
    editDialog.close();
    if (detailDialog.open && activeId) showDetail(activeId);
    if (result.invalidated) {
      showToast("关键字段已调整，未结束包装清单已失效并退回待交付", true);
    } else {
      showToast("已保存修改");
    }
  });
  document.querySelector("#cancelEdit").addEventListener("click", () => editDialog.close());

  // ---------- 详情 ----------
  function packingLabel(p) {
    if (p.status === "active") return "未结束";
    if (p.status === "invalid") return "已失效";
    return "已完成";
  }

  function detailActionsHtml(work) {
    const btns = [];
    if (work.status === "待交付") {
      btns.push(`<button class="violet" data-action="pack" data-id="${work.id}">创建包装清单</button>`);
    }
    if (work.status === "已包装") {
      btns.push(`<button class="violet" data-action="signoff" data-id="${work.id}">签收</button>`);
      btns.push(`<button class="secondary" data-action="void" data-id="${work.id}">作废清单</button>`);
    }
    if (work.status === "已签收") {
      btns.push(`<button class="warn" data-action="rework" data-id="${work.id}">发起返工</button>`);
    }
    if (work.status === "返工中") {
      btns.push(`<button class="violet" data-action="finishRework" data-id="${work.id}">完成返工</button>`);
    }
    btns.push(`<button class="secondary" data-action="edit" data-id="${work.id}">编辑作品</button>`);
    return btns.join("");
  }

  function showDetail(id) {
    const work = findWork(id);
    if (!work) return;
    activeId = id;
    detailTitle.textContent = `${work.theme} · ${work.base}`;
    const list = (items, render) =>
      items.length ? `<ul>${items.map(render).join("")}</ul>` : `<div class="empty">暂无</div>`;
    detailContent.innerHTML = `
      <div>胎体材质：${esc(work.base)}　线条粗细：${esc(work.line)}　贴线进度：${work.progress}%</div>
      <div>阴干日期：${esc(work.dryDate)}　金粉状态：${esc(work.gold)}　交付日期：${esc(work.delivery)}</div>
      <div>当前状态：${esc(work.status)}　缺陷位置：${esc(work.defect || "无")}</div>
      <div>备注：${esc(work.note || "无")}</div>
      <h3>包装清单（${work.packings.length}）</h3>
      ${list(work.packings, p => `<li>${packingLabel(p)} · ${fmtTime(p.createdAt)}${p.note ? " · " + esc(p.note) : ""}${p.closeReason ? " · " + esc(p.closeReason) : ""}</li>`)}
      <h3>签收记录（${work.signoffs.length}）</h3>
      ${list(work.signoffs, s => `<li>${esc(s.receiptNo)} · ${esc(s.recipient)} · 实际交付 ${esc(s.actualDate)}</li>`)}
      <h3>返工记录（${work.reworks.length}）</h3>
      ${list(work.reworks, r => `<li>${fmtTime(r.startedAt)}${r.reason ? " · " + esc(r.reason) : ""} · ${r.finishedAt ? "完成于 " + fmtTime(r.finishedAt) : "进行中"}${r.note ? " · " + esc(r.note) : ""}</li>`)}
      <h3>缺陷历史（${work.defectHistory.length}）</h3>
      ${list(work.defectHistory, d => `<li>${fmtTime(d.at)} · ${esc(d.text)}</li>`)}
      <h3>流转记录</h3>
      <div>${work.logs.map(esc).join("<br>")}</div>
    `;
    detailActions.innerHTML = detailActionsHtml(work);
    defectInput.value = "";
    if (!detailDialog.open) detailDialog.showModal();
  }

  document.querySelector("#saveDefect").addEventListener("click", () => {
    const work = findWork(activeId);
    if (!work) return;
    const r = Rules.recordDefect(work, defectInput.value);
    if (applyResult(r)) {
      showToast(r.invalidated ? "已记录缺陷，未结束包装清单已失效并退回待交付" : "已记录缺陷", !!r.invalidated);
    }
  });
  document.querySelector("#closeDialog").addEventListener("click", () => detailDialog.close());

  // ---------- 渲染 ----------
  function renderStats() {
    const s = Rules.stats(works, today);
    const items = [
      ["总作品", s.total, ""],
      ["待签收（已包装）", s.toSign, s.toSign ? "hot" : ""],
      ["已签收", s.signed, ""],
      ["返工中", s.reworking, s.reworking ? "warn" : ""],
      ["缺陷作品", s.defected, s.defected ? "warn" : ""],
      ["逾期未交付", s.overdue, s.overdue ? "hot" : ""],
      ["清单失效次数", s.invalidatedPackings, s.invalidatedPackings ? "warn" : ""],
      ["累计返工", s.reworks, ""]
    ];
    statsBar.innerHTML = items
      .map(([label, value, cls]) => `<div class="stat ${cls}"><div class="stat-num">${value}</div><div class="stat-label">${label}</div></div>`)
      .join("");
  }

  function miniItem(work, sub, cls) {
    return `<div class="item ${cls || ""}" data-detail="${work.id}"><b>${esc(work.theme)}</b><div class="meta">${sub}</div></div>`;
  }

  function renderSummaries() {
    const todayDry = works.filter(w => w.dryDate <= today && w.status === "待阴干");
    const defects = works.filter(w => w.defect);
    const delivered = works
      .filter(w => w.signoffs.length)
      .sort((a, b) => Rules.latestSignoff(b).actualDate.localeCompare(Rules.latestSignoff(a).actualDate))
      .slice(0, 4);
    document.querySelector("#todayDry").innerHTML = todayDry.length
      ? todayDry.map(w => miniItem(w, `${esc(w.base)} · ${esc(w.dryDate)}`)).join("")
      : `<div class="empty">暂无</div>`;
    document.querySelector("#defectList").innerHTML = defects.length
      ? defects.map(w => miniItem(w, esc(w.defect), "overdue")).join("")
      : `<div class="empty">暂无</div>`;
    document.querySelector("#deliveryList").innerHTML = delivered.length
      ? delivered.map(w => {
          const s = Rules.latestSignoff(w);
          return miniItem(w, `${esc(s.actualDate)} · ${esc(s.receiptNo)}`);
        }).join("")
      : `<div class="empty">暂无</div>`;
  }

  function filtered() {
    return works
      .filter(w => !statusFilter.value || w.status === statusFilter.value)
      .filter(w => !themeFilter.value || w.theme.includes(themeFilter.value.trim()))
      .sort((a, b) => (a[sortMode.value] || "").localeCompare(b[sortMode.value] || ""));
  }

  function cardMeta(work) {
    let extra = "";
    if (work.status === "已包装") {
      extra = "<br>清单：未结束（待签收）";
    } else if (work.status === "已签收") {
      const s = Rules.latestSignoff(work);
      if (s) extra = `<br>签收号：${esc(s.receiptNo)} · ${esc(s.recipient)}`;
    } else if (work.status === "返工中") {
      extra = `<br>返工次数：${work.reworks.length}`;
    }
    return `${esc(work.base)} · ${esc(work.line)}<br>进度 ${work.progress}% · 阴干 ${esc(work.dryDate)}<br>金粉：${esc(work.gold)} · 交付：${esc(work.delivery)}<br>${work.defect ? "缺陷：" + esc(work.defect) : "缺陷：无"}${extra}`;
  }

  function cardActions(work) {
    const btns = [];
    if (PRODUCTION.includes(work.status)) {
      for (const s of PRODUCTION) {
        btns.push(`<button class="${s === work.status ? "secondary" : ""}" data-action="status" data-id="${work.id}" data-status="${s}">${s}</button>`);
      }
      if (work.status === "待交付") {
        btns.push(`<button class="violet" data-action="pack" data-id="${work.id}">创建包装清单</button>`);
      }
    } else if (work.status === "已包装") {
      btns.push(`<button class="violet" data-action="signoff" data-id="${work.id}">签收</button>`);
      btns.push(`<button class="secondary" data-action="void" data-id="${work.id}">作废清单</button>`);
    } else if (work.status === "已签收") {
      btns.push(`<button class="warn" data-action="rework" data-id="${work.id}">发起返工</button>`);
    } else if (work.status === "返工中") {
      btns.push(`<button class="violet" data-action="finishRework" data-id="${work.id}">完成返工</button>`);
    }
    btns.push(`<button class="warn" data-action="defect" data-id="${work.id}">记缺陷</button>`);
    return btns.join("");
  }

  function renderBoard() {
    const list = filtered();
    board.innerHTML = STATUSES.map(status => {
      const cards = list.filter(w => w.status === status);
      return `<section class="col">
        <h3><span>${status}</span><span>${cards.length}</span></h3>
        ${cards.length
          ? cards.map(w => `<article class="item ${w.defect ? "overdue" : ""}" data-detail="${w.id}">
              <b>${esc(w.theme)}</b>
              <div class="meta">${cardMeta(w)}</div>
              <div class="actions">${cardActions(w)}</div>
            </article>`).join("")
          : `<div class="empty">暂无作品</div>`}
      </section>`;
    }).join("");
  }

  function render() {
    renderStats();
    renderSummaries();
    renderBoard();
  }

  // ---------- 事件 ----------
  // 事件委托：按钮（data-action）优先，其次卡片（data-detail）打开详情
  document.addEventListener("click", event => {
    const actionBtn = event.target.closest("[data-action]");
    if (actionBtn) {
      handleAction(actionBtn.dataset.action, actionBtn.dataset.id, actionBtn.dataset.status);
      return;
    }
    const detailEl = event.target.closest("[data-detail]");
    if (detailEl) showDetail(detailEl.dataset.detail);
  });

  form.addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    works.unshift({
      id: Rules.uid(),
      base: data.base,
      theme: data.theme,
      line: data.line,
      progress: Number(data.progress),
      dryDate: data.dryDate,
      gold: data.gold,
      defect: data.defect,
      delivery: data.delivery,
      status: data.status,
      note: data.note,
      logs: [`${new Date().toLocaleString()} 创建作品`],
      defectHistory: data.defect ? [{ at: new Date().toISOString(), text: data.defect }] : [],
      packings: [],
      signoffs: [],
      reworks: []
    });
    form.reset();
    field(form, "dryDate").value = today;
    field(form, "delivery").value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    Store.save(works);
    render();
    showToast("已加入工坊");
  });

  document.querySelector("#clearFilters").addEventListener("click", () => {
    themeFilter.value = "";
    statusFilter.value = "";
    render();
  });
  [statusFilter, themeFilter, sortMode].forEach(el => el.addEventListener("input", render));
  document.querySelector("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(works, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "lacquer-thread-works.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  Store.save(works);
  render();
})();

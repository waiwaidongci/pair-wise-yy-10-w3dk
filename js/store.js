/*
 * 持久化层
 * 只负责 localStorage 读写与数据迁移，不包含任何业务规则与界面逻辑。
 */
(function (root, factory) {
  const Store = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = Store;
  if (root) root.Store = Store;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const KEY = "zfl42Works";
  // 需要保证为数组的字段（含交付闭环新增的历史数据）
  const ARRAY_FIELDS = ["logs", "defectHistory", "packings", "signoffs", "reworks"];

  // 旧版本数据迁移：补齐闭环所需的数组字段，保证刷新后状态一致
  function normalize(work) {
    const next = { ...work };
    for (const field of ARRAY_FIELDS) {
      if (!Array.isArray(next[field])) next[field] = [];
    }
    return next;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(normalize) : null;
    } catch (error) {
      return null;
    }
  }

  function save(works) {
    localStorage.setItem(KEY, JSON.stringify(works));
  }

  return { KEY, load, save, normalize };
});

/*
 * 持久化层：只负责 JSON 的读取与写入，不含任何业务规则。
 * 浏览器默认使用 localStorage；测试时可注入内存版 storage。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Store = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function createStore(storage, key) {
    key = key || "zfl42Works";
    if (!storage) throw new Error("store 需要一个 storage 后端");

    return {
      key: key,
      load() {
        try {
          const raw = storage.getItem(key);
          return raw ? JSON.parse(raw) : null;
        } catch (e) {
          return null;
        }
      },
      save(works) {
        storage.setItem(key, JSON.stringify(works));
      },
      clear() {
        storage.removeItem(key);
      }
    };
  }

  // 内存后端，供测试与无 localStorage 的环境使用
  function memoryStorage(initial) {
    const map = new Map(initial ? Object.entries(initial) : []);
    return {
      getItem(k) { return map.has(k) ? map.get(k) : null; },
      setItem(k, v) { map.set(k, String(v)); },
      removeItem(k) { map.delete(k); }
    };
  }

  return { createStore, memoryStorage };
});

if (!window.storage) {
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem("__artifact_storage__") || "{}");
    } catch {
      return {};
    }
  };
  const write = (data) => localStorage.setItem("__artifact_storage__", JSON.stringify(data));

  window.storage = {
    async get(key, shared = false) {
      const data = read();
      const scope = shared ? "shared" : "personal";
      if (!data[scope] || !(key in data[scope])) {
        throw new Error(`Key not found: ${key}`);
      }
      return { key, value: data[scope][key], shared };
    },
    async set(key, value, shared = false) {
      const data = read();
      const scope = shared ? "shared" : "personal";
      data[scope] = data[scope] || {};
      data[scope][key] = value;
      write(data);
      return { key, value, shared };
    },
    async delete(key, shared = false) {
      const data = read();
      const scope = shared ? "shared" : "personal";
      let deleted = false;
      if (data[scope] && key in data[scope]) {
        delete data[scope][key];
        write(data);
        deleted = true;
      }
      return { key, deleted, shared };
    },
    async list(prefix = "", shared = false) {
      const data = read();
      const scope = shared ? "shared" : "personal";
      const keys = Object.keys(data[scope] || {}).filter((k) => k.startsWith(prefix));
      return { keys, prefix, shared };
    },
  };
}
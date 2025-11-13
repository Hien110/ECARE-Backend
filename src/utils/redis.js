// utils/redis.js
// Mock Redis in-memory dùng Map (chạy local)
// Sau này có thể thay bằng Redis thật (ioredis)

class RedisMock {
  constructor() {
    this.store = new Map();
  }

  async set(key, value, mode, ttl) {
  this.store.set(key, value);

  if (mode === "EX" && ttl) {
    if (process.env.NODE_ENV !== "development") {
      setTimeout(() => {
        this.store.delete(key);
      }, ttl * 1000);
    }
  }
  return "OK";
}

  async get(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }

  async del(key) {
    return this.store.delete(key);
  }
}

module.exports = new RedisMock();

'use strict';

function postgres(pool) {
  return { query: (text, params = []) => pool.query(text, params) };
}

function sequelize(instance) {
  return {
    async query(text, params = []) {
      const [rows, metadata] = await instance.query(text, { bind: params });
      const normalized = Array.isArray(rows) ? rows : [];
      return { rows: normalized, rowCount: normalized.length || Number(metadata && metadata.rowCount || 0) };
    }
  };
}

module.exports = { postgres, sequelize };


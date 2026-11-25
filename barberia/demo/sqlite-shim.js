// Implementazione di `node:sqlite` (DatabaseSync) sopra sql.js, per la demo nel browser.
export class DatabaseSync {
  constructor() {
    const SQL = globalThis.__SQL;
    const saved = globalThis.__DEMO_SAVED;
    this.db = saved ? new SQL.Database(saved) : new SQL.Database();
  }
  exec(sql) {
    this.db.exec(sql.replace(/PRAGMA journal_mode\s*=\s*WAL;/i, ''));
  }
  prepare(sql) {
    const db = this.db;
    const norm = (p) => p.map((v) => (v === undefined ? null : typeof v === 'bigint' ? Number(v) : v));
    return {
      get(...p) {
        const st = db.prepare(sql);
        try { st.bind(norm(p)); return st.step() ? st.getAsObject() : undefined; } finally { st.free(); }
      },
      all(...p) {
        const st = db.prepare(sql);
        const out = [];
        try { st.bind(norm(p)); while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); }
      },
      run(...p) {
        db.run(sql, norm(p));
        const id = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
        return { lastInsertRowid: id, changes: db.getRowsModified() };
      },
    };
  }
}

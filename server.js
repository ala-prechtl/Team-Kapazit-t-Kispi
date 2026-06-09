const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ── Init schema ──────────────────────────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS status (
      member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      traffic_light TEXT CHECK(traffic_light IN ('green','yellow','red','absent')),
      comment TEXT DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS status_history (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
      member_name TEXT NOT NULL,
      traffic_light TEXT NOT NULL,
      comment TEXT DEFAULT '',
      recorded_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Seed if empty
  const { rows } = await pool.query('SELECT COUNT(*) FROM members');
  if (parseInt(rows[0].count) === 0) {
    const names = ['Alexandra','Bea','Gina','Jasmin','Katja','Larissa','Nora','Romina','Sabrina','Sarah','Ursi','Yaelle'];
    for (const name of names) {
      await pool.query('INSERT INTO members (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
    }
    console.log('Seed: Team angelegt');
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET all team members with current status
app.get('/api/team', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT m.id, m.name,
           COALESCE(s.traffic_light, 'none') AS traffic_light,
           COALESCE(s.comment, '') AS comment,
           s.updated_at
    FROM members m
    LEFT JOIN status s ON s.member_id = m.id
    ORDER BY m.name
  `);
  res.json(rows);
});

// POST update status (today)
app.post('/api/status', async (req, res) => {
  const { member_id, traffic_light, comment } = req.body;
  const allowed = ['green','yellow','red','absent'];
  if (!member_id || !allowed.includes(traffic_light))
    return res.status(400).json({ error: 'Invalid request' });

  const { rows } = await pool.query('SELECT name FROM members WHERE id=$1', [member_id]);
  if (!rows.length) return res.status(404).json({ error: 'Member not found' });

  await pool.query(`
    INSERT INTO status (member_id, traffic_light, comment, updated_at)
    VALUES ($1,$2,$3,NOW())
    ON CONFLICT (member_id) DO UPDATE SET
      traffic_light=EXCLUDED.traffic_light,
      comment=EXCLUDED.comment,
      updated_at=NOW()
  `, [member_id, traffic_light, comment || '']);

  await pool.query(`
    INSERT INTO status_history (member_id, member_name, traffic_light, comment)
    VALUES ($1,$2,$3,$4)
  `, [member_id, rows[0].name, traffic_light, comment || '']);

  res.json({ ok: true });
});

// DELETE current status for a member
app.delete('/api/status/:member_id', async (req, res) => {
  await pool.query('DELETE FROM status WHERE member_id=$1', [req.params.member_id]);
  res.json({ ok: true });
});

// DELETE historic status for a specific day
app.delete('/api/status/historic/:member_id/:date', async (req, res) => {
  const { member_id, date } = req.params;
  await pool.query(
    'DELETE FROM status_history WHERE member_id=$1 AND DATE(recorded_at)=$2',
    [member_id, date]
  );
  res.json({ ok: true });
});

// POST set status for a past date (retrospective)
app.post('/api/status/historic', async (req, res) => {
  const { member_id, date, traffic_light, comment } = req.body;
  const allowed = ['green','yellow','red','absent'];
  if (!member_id || !date || !allowed.includes(traffic_light))
    return res.status(400).json({ error: 'Invalid request' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: 'Invalid date' });

  const { rows } = await pool.query('SELECT name FROM members WHERE id=$1', [member_id]);
  if (!rows.length) return res.status(404).json({ error: 'Member not found' });

  // Replace existing entry for that member+day
  await pool.query(`
    DELETE FROM status_history
    WHERE member_id=$1 AND DATE(recorded_at)=$2
  `, [member_id, date]);

  await pool.query(`
    INSERT INTO status_history (member_id, member_name, traffic_light, comment, recorded_at)
    VALUES ($1,$2,$3,$4,$5::date + TIME '12:00:00')
  `, [member_id, rows[0].name, traffic_light, comment || '', date]);

  res.json({ ok: true });
});

// POST add team member
app.post('/api/team', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO members (name) VALUES ($1) RETURNING id, name', [name.trim()]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Name already exists' });
    throw e;
  }
});

// DELETE team member
app.delete('/api/team/:id', async (req, res) => {
  await pool.query('DELETE FROM members WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// GET report with date range
app.get('/api/report', async (req, res) => {
  let { from, to } = req.query;
  if (!from || !to) {
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0');
    const last = new Date(y, now.getMonth()+1, 0).getDate();
    from = `${y}-${m}-01`;
    to   = `${y}-${m}-${String(last).padStart(2,'0')}`;
  }

  const { rows } = await pool.query(`
    SELECT member_name, traffic_light, DATE(recorded_at) AS day
    FROM status_history
    WHERE DATE(recorded_at) BETWEEN $1 AND $2
    ORDER BY recorded_at
  `, [from, to]);

  // daily[member_name][YYYY-MM-DD] = last status of that day
  const dailyMap = {};
  rows.forEach(r => {
    const day = r.day.toISOString().slice(0,10);
    if (!dailyMap[r.member_name]) dailyMap[r.member_name] = {};
    dailyMap[r.member_name][day] = r.traffic_light;
  });

  // summary per member per status (count of days)
  const summaryMap = {};
  Object.entries(dailyMap).forEach(([name, days]) => {
    summaryMap[name] = { green:0, yellow:0, red:0, absent:0 };
    Object.values(days).forEach(s => { if (summaryMap[name][s] !== undefined) summaryMap[name][s]++; });
  });

  const summary = Object.entries(summaryMap)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([member_name, counts]) => ({ member_name, ...counts }));

  res.json({ from, to, daily: dailyMap, summary });
});

// GET export CSV
app.get('/api/export/csv', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT DATE(recorded_at) AS day, member_name, traffic_light, comment
    FROM status_history ORDER BY recorded_at
  `);
  const STATUS_DE = { green:'Freie Kapazität', yellow:'Teilweise ausgelastet', red:'Voll ausgelastet', absent:'Abwesend' };
  const header = 'Datum,Name,Status,Kommentar';
  const lines = rows.map(r => {
    const date = r.day.toISOString().slice(0,10);
    const status = STATUS_DE[r.traffic_light] || r.traffic_light;
    const comment = (r.comment||'').replace(/"/g,'""');
    return `${date},"${r.member_name}","${status}","${comment}"`;
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="team-kapazitaet.csv"');
  res.send([header, ...lines].join('\n'));
});

// Start
initDB()
  .then(() => app.listen(PORT, () => console.log(`Team Capacity running on port ${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });

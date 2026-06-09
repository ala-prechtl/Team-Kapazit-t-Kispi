const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── JSON file database ──────────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || './data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'db.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) return { members: [], status: {}, history: [] };
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// Seed team members if empty
const _db = loadDB();
if (_db.members.length === 0) {
  const names = ['Alexandra','Bea','Gina','Jasmin','Katja','Larissa','Nora','Romina','Sabrina','Sarah','Ursi','Yaelle'];
  _db.members = names.map((name, i) => ({ id: i + 1, name, created_at: new Date().toISOString() }));
  saveDB(_db);
  console.log('Seed: Team angelegt');
}

// ── Routes ──────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET all team members with their current status
app.get('/api/team', (req, res) => {
  const db = loadDB();
  const result = db.members
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(m => ({
      id: m.id,
      name: m.name,
      traffic_light: db.status[m.id]?.traffic_light || 'none',
      comment: db.status[m.id]?.comment || '',
      updated_at: db.status[m.id]?.updated_at || null,
    }));
  res.json(result);
});

// POST update status for a member
app.post('/api/status', (req, res) => {
  const { member_id, traffic_light, comment } = req.body;
  const allowed = ['green', 'yellow', 'red', 'absent'];
  if (!member_id || !traffic_light || !allowed.includes(traffic_light)) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const db = loadDB();
  const member = db.members.find(m => m.id === Number(member_id));
  if (!member) return res.status(404).json({ error: 'Member not found' });

  db.status[member_id] = { traffic_light, comment: comment || '', updated_at: new Date().toISOString() };
  db.history.push({ member_id: Number(member_id), member_name: member.name, traffic_light, comment: comment || '', recorded_at: new Date().toISOString() });
  saveDB(db);
  res.json({ ok: true });
});

// POST add a new team member
app.post('/api/team', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });

  const db = loadDB();
  if (db.members.find(m => m.name.toLowerCase() === name.trim().toLowerCase())) {
    return res.status(409).json({ error: 'Name already exists' });
  }
  const id = db.members.length > 0 ? Math.max(...db.members.map(m => m.id)) + 1 : 1;
  const member = { id, name: name.trim(), created_at: new Date().toISOString() };
  db.members.push(member);
  saveDB(db);
  res.json(member);
});

// POST set status for a specific past date (retrospective)
app.post('/api/status/historic', (req, res) => {
  const { member_id, date, traffic_light, comment } = req.body;
  const allowed = ['green', 'yellow', 'red', 'absent'];
  if (!member_id || !date || !traffic_light || !allowed.includes(traffic_light)) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  // Validate date format YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format' });
  }

  const db = loadDB();
  const member = db.members.find(m => m.id === Number(member_id));
  if (!member) return res.status(404).json({ error: 'Member not found' });

  // Remove existing entry for that member+day, then insert new one
  db.history = db.history.filter(h =>
    !(h.member_id === Number(member_id) && h.recorded_at.startsWith(date))
  );
  db.history.push({
    member_id: Number(member_id),
    member_name: member.name,
    traffic_light,
    comment: comment || '',
    recorded_at: `${date}T12:00:00.000Z`
  });
  saveDB(db);
  res.json({ ok: true });
});

// DELETE a team member
app.delete('/api/team/:id', (req, res) => {
  const id = Number(req.params.id);
  const db = loadDB();
  db.members = db.members.filter(m => m.id !== id);
  delete db.status[id];
  saveDB(db);
  res.json({ ok: true });
});

// GET report — supports ?from=YYYY-MM-DD&to=YYYY-MM-DD
app.get('/api/report', (req, res) => {
  let { from, to } = req.query;

  // Fallback: today's month
  if (!from || !to) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const last = new Date(y, now.getMonth() + 1, 0).getDate();
    from = `${y}-${m}-01`;
    to   = `${y}-${m}-${String(last).padStart(2, '0')}`;
  }

  const db = loadDB();
  const entries = db.history.filter(h => {
    const d = h.recorded_at.slice(0, 10);
    return d >= from && d <= to;
  });

  // daily[member_name][YYYY-MM-DD] = last traffic_light of that day
  const dailyMap = {};
  entries.forEach(h => {
    const day = h.recorded_at.slice(0, 10);
    if (!dailyMap[h.member_name]) dailyMap[h.member_name] = {};
    dailyMap[h.member_name][day] = h.traffic_light;
  });

  // summary per member per status (count of days)
  const summaryMap = {};
  Object.entries(dailyMap).forEach(([name, days]) => {
    summaryMap[name] = { green: 0, yellow: 0, red: 0, absent: 0 };
    Object.values(days).forEach(s => {
      if (summaryMap[name][s] !== undefined) summaryMap[name][s]++;
    });
  });

  const summary = Object.entries(summaryMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([member_name, counts]) => ({ member_name, ...counts }));

  res.json({ from, to, daily: dailyMap, summary });
});

// GET export all history as CSV
app.get('/api/export/csv', (req, res) => {
  const db = loadDB();
  const STATUS_DE = { green: 'Freie Kapazität', yellow: 'Teilweise ausgelastet', red: 'Voll ausgelastet', absent: 'Abwesend' };
  const header = 'Datum,Name,Status,Kommentar';
  const rows = db.history
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
    .map(h => {
      const date = h.recorded_at.slice(0, 10);
      const status = STATUS_DE[h.traffic_light] || h.traffic_light;
      const comment = (h.comment || '').replace(/"/g, '""');
      return `${date},"${h.member_name}","${status}","${comment}"`;
    });
  const csv = [header, ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="team-kapazitaet.csv"');
  res.send(csv);
});

app.listen(PORT, () => {
  console.log(`Team Capacity running on http://localhost:${PORT}`);
});

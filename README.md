# Team Kapazität – Deployment & Nutzung

## Lokal starten

```bash
cd team-capacity
npm install
npm start
# → http://localhost:3000
```

---

## Auf einen Server bringen (Render.com – kostenlos)

### Schritt 1: GitHub Repository anlegen

1. Gehe auf [github.com](https://github.com) → **New repository**
2. Name z.B. `team-capacity`, privat oder öffentlich, ohne README anlegen
3. Im Terminal (im `team-capacity`-Ordner):

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/DEIN-USERNAME/team-capacity.git
git push -u origin main
```

### Schritt 2: Render.com Account anlegen

1. Gehe auf [render.com](https://render.com) → kostenlos registrieren (mit GitHub-Login am einfachsten)

### Schritt 3: Web Service deployen

1. Dashboard → **New +** → **Web Service**
2. GitHub verbinden und dein Repository `team-capacity` auswählen
3. Einstellungen:
   - **Name:** team-capacity (oder beliebig)
   - **Region:** Frankfurt (EU Central) empfohlen
   - **Branch:** main
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
4. **Create Web Service** klicken
5. Nach ~2 Minuten ist die App live unter einer URL wie `https://team-capacity-xyz.onrender.com`

> Diese URL kannst du an alle Teammitglieder schicken.

### ⚠️ Wichtig: Daten bleiben im kostenlosen Plan nicht dauerhaft erhalten

Im kostenlosen Render-Plan wird die App bei Inaktivität schlafen gelegt und beim Aufwachen
ggf. zurückgesetzt — die `db.json` geht dabei verloren.

**Lösung A (empfohlen, kostenlos):** Auf [Railway.app](https://railway.app) deployen statt Render.
Railway behält den Dateisystem-Zustand auch im kostenlosen Plan.

**Lösung B:** Render Persistent Disk aktivieren (ca. $0.25/GB/Monat):
- Im Render Dashboard → dein Service → **Disks** → **Add Disk**
- Mount Path: `/var/data`
- Dann Environment Variable setzen: `DATA_DIR` = `/var/data`

---

## CSV-Export

Alle gespeicherten Daten (komplette History) als CSV herunterladen:

- Im Browser direkt: `https://DEINE-URL/api/export/csv`
- Oder im Tab „Monatsauswertung" auf den Button **⬇ CSV exportieren** klicken

Das CSV enthält: Datum, Name, Status, Kommentar – und kann direkt in Excel oder Numbers geöffnet werden.

---

## Projektstruktur

```
team-capacity/
├── server.js          # Express Backend + JSON-Datenbank + API
├── package.json
├── data/
│   └── db.json        # Datenbank (wird automatisch angelegt)
└── public/
    └── index.html     # Frontend (Single Page App)
```

## API-Übersicht

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| GET | `/api/team` | Alle Mitglieder mit aktuellem Status |
| POST | `/api/team` | Mitglied hinzufügen `{ name }` |
| DELETE | `/api/team/:id` | Mitglied löschen |
| POST | `/api/status` | Status heute setzen `{ member_id, traffic_light, comment }` |
| POST | `/api/status/historic` | Status für Vergangenheit setzen `{ member_id, date, traffic_light, comment }` |
| GET | `/api/report?from=YYYY-MM-DD&to=YYYY-MM-DD` | Auswertung für Zeitraum |
| GET | `/api/export/csv` | Gesamte History als CSV |

const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const path = require("path");

const app = express();
const PORT = 3000;

const db = new sqlite3.Database("security.db");

// ✅ MUST be first
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: "ai_security_key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

// ---------------- DB ----------------
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      time TEXT,
      image TEXT,
      age INTEGER,
      gender TEXT,
      features TEXT
    )
  `);
});

// ---------------- AUTH MIDDLEWARE ----------------
function auth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ---------------- AUTH ROUTES ----------------
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;

  const hash = await bcrypt.hash(password, 10);

  db.run(
    "INSERT INTO users (username, password) VALUES (?,?)",
    [username, hash],
    err => {
      if (err) return res.status(400).json({ error: "User exists" });
      res.json({ ok: true });
    }
  );
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  db.get(
    "SELECT * FROM users WHERE username = ?",
    [username],
    async (err, user) => {
      if (!user) return res.status(401).json({ error: "Invalid login" });

      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return res.status(401).json({ error: "Invalid login" });

      req.session.user = user;
      res.json({ ok: true });
    }
  );
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

// ---------------- LOGS ----------------
app.get("/api/logs", auth, (req, res) => {
  db.all(
    "SELECT * FROM logs WHERE user_id = ? ORDER BY id DESC",
    [req.session.user.id],
    (err, rows) => {
      if (err) return res.status(500).json([]);
      res.json(rows);
    }
  );
});

app.post("/api/logs", auth, (req, res) => {
  const b = req.body;

  db.run(
    `INSERT INTO logs (user_id, time, image, age, gender, features)
     VALUES (?,?,?,?,?,?)`,
    [
      req.session.user.id,
      b.time,
      b.image,
      b.age,
      b.gender,
      JSON.stringify(b.features || [])
    ],
    () => res.json({ ok: true })
  );
});

app.delete("/api/clear", auth, (req, res) => {
  db.run("DELETE FROM logs WHERE user_id = ?", [req.session.user.id]);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log("Running on http://localhost:" + PORT));
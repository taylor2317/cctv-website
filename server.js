const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const path = require("path");

const app = express();

const db = new sqlite3.Database("./database.db");

// ---------------- MIDDLEWARE ----------------
app.use(express.json({
  limit: "50mb"
}));

app.use(express.urlencoded({
  extended: true,
  limit: "50mb"
}));

app.use(session({
  secret: "secret-key",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    sameSite: "lax"
  }
}));

// ---------------- STATIC ----------------
app.use(express.static(path.join(__dirname, "public")));
app.use("/models", express.static(path.join(__dirname, "models")));

// ---------------- DATABASE ----------------
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
      image TEXT,
      age TEXT,
      gender TEXT,
      time TEXT
    )
  `);

});

// ---------------- AUTH MIDDLEWARE ----------------
function auth(req, res, next) {

  if (!req.session.userId) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  next();
}

// ======================================================
// PAGES
// ======================================================

// LOGIN PAGE
app.get("/", (req, res) => {

  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );

});

// DASHBOARD PAGE
app.get("/dashboard", (req, res) => {

  if (!req.session.userId) {
    return res.redirect("/");
  }

  res.sendFile(
    path.join(__dirname, "public", "dashboard.html")
  );

});

// ======================================================
// AUTH API
// ======================================================

// REGISTER
app.post("/api/register", async (req, res) => {

  try {

    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: "Missing fields"
      });
    }

    const hash = await bcrypt.hash(password, 10);

    db.run(
      `
      INSERT INTO users (username, password)
      VALUES (?, ?)
      `,
      [username, hash],
      function(err) {

        if (err) {
          return res.status(400).json({
            error: "Username already exists"
          });
        }

        res.json({
          ok: true
        });
      }
    );

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Server error"
    });
  }

});

// LOGIN
app.post("/api/login", (req, res) => {

  const { username, password } = req.body;

  db.get(
    `
    SELECT * FROM users
    WHERE username = ?
    `,
    [username],
    async (err, user) => {

      if (err || !user) {
        return res.status(401).json({
          error: "Invalid login"
        });
      }

      const valid =
        await bcrypt.compare(
          password,
          user.password
        );

      if (!valid) {
        return res.status(401).json({
          error: "Invalid login"
        });
      }

      req.session.userId = user.id;

      req.session.save(() => {

        res.json({
          ok: true
        });

      });
    }
  );
});

// LOGOUT
app.post("/api/logout", (req, res) => {

  req.session.destroy(() => {

    res.json({
      ok: true
    });

  });
});

// CURRENT USER
app.get("/api/me", (req, res) => {

  if (!req.session.userId) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  db.get(
    `
    SELECT id, username
    FROM users
    WHERE id = ?
    `,
    [req.session.userId],
    (err, user) => {

      if (err || !user) {
        return res.status(401).json({
          error: "Unauthorized"
        });
      }

      res.json({
        user
      });
    }
  );
});

// ======================================================
// LOGS API
// ======================================================

// GET LOGS
app.get("/api/logs", auth, (req, res) => {

  db.all(
    `
    SELECT *
    FROM logs
    WHERE user_id = ?
    ORDER BY id DESC
    `,
    [req.session.userId],
    (err, rows) => {

      if (err) {

        console.error(err);

        return res.status(500).json({
          error: "Database error"
        });
      }

      res.json(rows);
    }
  );
});

// ADD LOG
app.post("/api/logs", auth, (req, res) => {

  const {
    image,
    age,
    gender,
    time
  } = req.body;

  db.run(
    `
    INSERT INTO logs (
      user_id,
      image,
      age,
      gender,
      time
    )
    VALUES (?, ?, ?, ?, ?)
    `,
    [
      req.session.userId,
      image,
      age,
      gender,
      time
    ],
    function(err) {

      if (err) {

        console.error(err);

        return res.status(500).json({
          error: "Insert failed"
        });
      }

      res.json({
        ok: true
      });
    }
  );
});

// CLEAR LOGS
app.delete("/api/clear", auth, (req, res) => {

  db.run(
    `
    DELETE FROM logs
    WHERE user_id = ?
    `,
    [req.session.userId],
    err => {

      if (err) {

        console.error(err);

        return res.status(500).json({
          error: "Delete failed"
        });
      }

      res.json({
        ok: true
      });
    }
  );
});

// ======================================================
// START SERVER
// ======================================================

app.listen(3000, () => {

  console.log(
    "Server running on http://localhost:3000"
  );

});
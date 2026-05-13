const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();

const DB_PATH = process.env.SECURITY_DB_PATH || "./security.db";
const KEY_PATH = path.join(__dirname, ".security-key");
const ENCRYPTED_PREFIX = "enc:v1:";

const db = new sqlite3.Database(DB_PATH);
const encryptionKey = loadEncryptionKey();

function loadEncryptionKey() {
  if (process.env.SECURITY_ENCRYPTION_KEY) {
    const value = process.env.SECURITY_ENCRYPTION_KEY.trim();
    const decoded = Buffer.from(value, "base64");

    if (decoded.length === 32) {
      return decoded;
    }

    return crypto
      .createHash("sha256")
      .update(value)
      .digest();
  }

  if (fs.existsSync(KEY_PATH)) {
    return Buffer.from(
      fs.readFileSync(KEY_PATH, "utf8").trim(),
      "base64"
    );
  }

  const key = crypto.randomBytes(32);

  fs.writeFileSync(KEY_PATH, key.toString("base64"), {
    mode: 0o600
  });

  return key;
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function usernameLookup(username) {
  return crypto
    .createHmac("sha256", encryptionKey)
    .update(normalizeUsername(username))
    .digest("hex");
}

function encryptText(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    encryptionKey,
    iv
  );
  const encrypted = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTED_PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64")
  ].join(".");
}

function isEncrypted(value) {
  return typeof value === "string" &&
    value.startsWith(ENCRYPTED_PREFIX);
}

function decryptText(value) {
  if (!isEncrypted(value)) {
    return value;
  }

  const [, iv, tag, encrypted] = value.split(".");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    Buffer.from(iv, "base64")
  );

  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function publicUser(user) {
  return {
    id: user.id,
    username: decryptText(
      user.username_encrypted || user.username
    )
  };
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve(this);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows);
    });
  });
}

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
async function columnExists(table, column) {
  const columns = await dbAll(`PRAGMA table_info(${table})`);

  return columns.some(item => item.name === column);
}

async function addColumn(table, column, definition) {
  if (await columnExists(table, column)) {
    return;
  }

  await dbRun(`
    ALTER TABLE ${table}
    ADD COLUMN ${column} ${definition}
  `);
}

async function initializeDatabase() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT
    )
  `);

  await addColumn("users", "username_encrypted", "TEXT");
  await addColumn("users", "username_lookup", "TEXT");

  await dbRun(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      image TEXT,
      age TEXT,
      gender TEXT,
      time TEXT
    )
  `);

  await addColumn("logs", "camera", "TEXT");

  const users = await dbAll(`
    SELECT id, username, password, username_encrypted, username_lookup
    FROM users
  `);

  for (const user of users) {
    const username = decryptText(
      user.username_encrypted || user.username
    );
    const encryptedUsername = isEncrypted(user.username)
      ? user.username
      : encryptText(username);
    const lookup = user.username_lookup ||
      usernameLookup(username);
    const password = String(user.password || "");
    const passwordHash = password.startsWith("$2")
      ? password
      : await bcrypt.hash(password, 10);

    await dbRun(
      `
      UPDATE users
      SET username = ?,
          username_encrypted = ?,
          username_lookup = ?,
          password = ?
      WHERE id = ?
      `,
      [
        encryptedUsername,
        encryptedUsername,
        lookup,
        passwordHash,
        user.id
      ]
    );
  }

  await dbRun(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lookup
    ON users(username_lookup)
  `);

  await dbRun(`
    UPDATE logs
    SET camera = 'Camera 1'
    WHERE camera IS NULL OR camera = ''
  `);
}

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
    const encryptedUsername = encryptText(username.trim());
    const lookup = usernameLookup(username);

    db.run(
      `
      INSERT INTO users (
        username,
        username_encrypted,
        username_lookup,
        password
      )
      VALUES (?, ?, ?, ?)
      `,
      [
        encryptedUsername,
        encryptedUsername,
        lookup,
        hash
      ],
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
    SELECT *
    FROM users
    WHERE username_lookup = ?
    `,
    [usernameLookup(username)],
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
    SELECT id, username, username_encrypted
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
        user: publicUser(user)
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
    camera,
    time
  } = req.body;

  db.run(
    `
    INSERT INTO logs (
      user_id,
      image,
      age,
      gender,
      camera,
      time
    )
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      req.session.userId,
      image,
      age,
      gender,
      camera || "Camera 1",
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

initializeDatabase()
  .then(() => {
    app.listen(3000, () => {

      console.log(
        "Server running on http://localhost:3000"
      );

    });
  })
  .catch(err => {
    console.error("Database initialization failed:", err);
    process.exit(1);
  });

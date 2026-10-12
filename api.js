require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

if (!process.env.JWT_ACCESS_SECRET) {
  console.error('Missing JWT_ACCESS_SECRET in .env');
  process.exit(1);
}

const dbBase = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 3, 
};
const moviesPool = mysql.createPool({ ...dbBase, database: process.env.MOVIES_DB_NAME || 'erdtesting' });
const authPool = mysql.createPool({ ...dbBase, database: process.env.AUTH_DB_NAME || 'jwt_demo' });

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(cookieParser());


const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const AVATAR_DIR = path.join(UPLOAD_ROOT, 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const IMAGE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATAR_DIR),
    filename: (req, file, cb) =>
      cb(null, `user-${req.user.id}-${Date.now()}${IMAGE_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    IMAGE_TYPES[file.mimetype]
      ? cb(null, true)
      : cb(new Error('Only JPG, PNG, WEBP or GIF pictures are allowed')),
}).single('avatar');

function handleAvatarUpload(req, res, next) {
  avatarUpload(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Picture must be 2 MB or smaller' : err.message;
    res.status(400).json({ message });
  });
}

function removeAvatarFile(avatarPath) {
  if (!avatarPath || !avatarPath.startsWith('/uploads/avatars/')) return;
  fs.unlink(path.join(AVATAR_DIR, path.basename(avatarPath)), () => {});
}

app.use(
  '/uploads',
  express.static(UPLOAD_ROOT, {
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  })
);


app.get('/api/movies', authenticate, async (req, res) => {
  try {
    const { search, quality, genre, rating, year } = req.query;
    const where = [];
    const params = [];

    if (search) { where.push('m.title LIKE ?'); params.push(`%${search}%`); }
    if (genre) { where.push('m.genres LIKE ?'); params.push(`%${genre}%`); }
    if (rating) { where.push('m.rating >= ?'); params.push(Number(rating)); }
    if (year) { where.push('m.year = ?'); params.push(Number(year)); }
    if (quality) {
      where.push('EXISTS (SELECT 1 FROM torrent t WHERE t.Movie_id = m.Movie_id AND t.quality = ?)');
      params.push(quality);
    }

    const sql = `
      SELECT m.Movie_id AS id, m.title, m.rating, m.year, m.genres,
        (SELECT i.Image_url FROM movie_image i
          WHERE i.Movie_id = m.Movie_id AND i.Image_type = 'medium_cover' LIMIT 1) AS cover
      FROM movie m
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY m.Movie_id DESC
      LIMIT 100`;

    const [rows] = await moviesPool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/movies/:id', authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid movie id' });
    }

    let rows;
    try {
      [rows] = await moviesPool.query(
        `SELECT m.Movie_id AS id, m.title, m.rating, COALESCE(m.year, d.year) AS year,
                m.genres, m.language, d.title_long, d.runtime, d.mpa_rating, d.like_count,
                d.imdb_code, d.description_intro, d.description_full, d.yt_trailer_code,
                (d.Movie_id IS NOT NULL) AS has_details
           FROM movie m
           LEFT JOIN movie_details d ON d.Movie_id = m.Movie_id
          WHERE m.Movie_id = ?`,
        [id]
      );
    } catch (err) {
      if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
      [rows] = await moviesPool.query(
        `SELECT Movie_id AS id, title, rating, year, genres, language, 0 AS has_details
           FROM movie WHERE Movie_id = ?`,
        [id]
      );
    }
    const m = rows[0];
    if (!m) return res.status(404).json({ message: 'Movie not found' });

    const [imageRows] = await moviesPool.query(
      'SELECT Image_type, Image_url FROM movie_image WHERE Movie_id = ?',
      [id]
    );
    const images = Object.fromEntries(imageRows.map((r) => [r.Image_type, r.Image_url]));

    const [cast] = await moviesPool.query(
      'SELECT ActorName AS name, CharacterName AS character_name FROM movie_cast WHERE Movie_id = ? ORDER BY Cast_id',
      [id]
    );
    const [torrentRows] = await moviesPool.query(
      'SELECT DISTINCT quality FROM torrent WHERE Movie_id = ? ORDER BY quality',
      [id]
    );

    res.json({
      id: m.id,
      title: m.title,
      title_long: m.title_long || null,
      year: m.year,
      rating: m.rating,
      runtime: m.runtime || null,
      genres: m.genres ? String(m.genres).split(',').map((g) => g.trim()).filter(Boolean) : [],
      language: m.language,
      mpa_rating: m.mpa_rating || null,
      like_count: m.like_count ?? null,
      imdb_code: m.imdb_code || null,
      description: m.description_full || m.description_intro || null,
      trailer_code: m.yt_trailer_code || null,
      cover: images.large_cover || images.medium_cover || null,
      background: images.background || null,
      cast,
      qualities: torrentRows.map((r) => r.quality),
      has_details: Boolean(m.has_details),
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error' });
  }
});


const auth = express.Router();
const ACCESS_TTL = '15m';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function signAccessToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: ACCESS_TTL,
  });
}

async function issueRefreshToken(res, userId) {
  const token = crypto.randomBytes(64).toString('hex');
  await authPool.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, sha256(token), new Date(Date.now() + REFRESH_TTL_MS)]
  );
  res.cookie('refreshToken', token, { ...cookieOptions, maxAge: REFRESH_TTL_MS });
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'No token provided' });
  try {
    req.user = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}

auth.post('/register', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const [existing] = await authPool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 10);
    await authPool.query('INSERT INTO users (email, password_hash) VALUES (?, ?)', [email, hash]);
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

auth.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const [rows] = await authPool.query('SELECT * FROM users WHERE email = ?', [email]);
    const user = rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    await issueRefreshToken(res, user.id);
    res.json({ accessToken: signAccessToken(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

auth.post('/refresh', async (req, res) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) return res.status(401).json({ message: 'No refresh token' });

    const [rows] = await authPool.query(
      `SELECT rt.id, rt.user_id, rt.expires_at, u.email
         FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = ?`,
      [sha256(token)]
    );
    const row = rows[0];

    if (!row || new Date(row.expires_at) < new Date()) {
      if (row) await authPool.query('DELETE FROM refresh_tokens WHERE id = ?', [row.id]);
      res.clearCookie('refreshToken', cookieOptions);
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }

    await authPool.query('DELETE FROM refresh_tokens WHERE id = ?', [row.id]);
    await issueRefreshToken(res, row.user_id);

    res.json({ accessToken: signAccessToken({ id: row.user_id, email: row.email }) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

auth.post('/logout', async (req, res) => {
  try {
    const token = req.cookies.refreshToken;
    if (token) {
      await authPool.query('DELETE FROM refresh_tokens WHERE token_hash = ?', [sha256(token)]);
    }
    res.clearCookie('refreshToken', cookieOptions);
    res.json({ message: 'Logged out' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

async function getUserById(id) {
  const [rows] = await authPool.query(
    'SELECT id, email, username, phone, avatar FROM users WHERE id = ?',
    [id]
  );
  return rows[0];
}

auth.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

auth.put('/profile', authenticate, async (req, res) => {
  try {
    const username = String(req.body.username ?? '').trim();
    const phone = String(req.body.phone ?? '').trim();

    if (username.length > 100) {
      return res.status(400).json({ message: 'Username must be 100 characters or less' });
    }
    if (phone && !/^\+?[0-9\s()-]{7,20}$/.test(phone)) {
      return res.status(400).json({ message: 'Enter a valid phone number' });
    }

    await authPool.query('UPDATE users SET username = ?, phone = ? WHERE id = ?', [
      username || null,
      phone || null,
      req.user.id,
    ]);
    res.json({ user: await getUserById(req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

auth.post('/change-password', authenticate, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }
    if (Buffer.byteLength(newPassword) > 72) {
      return res.status(400).json({ message: 'New password is too long (72 bytes maximum)' });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ message: 'New password must be different from the current one' });
    }

    const [rows] = await authPool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ message: 'User not found' });

    if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await authPool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);

    const keep = req.cookies.refreshToken ? sha256(req.cookies.refreshToken) : '';
    await authPool.query('DELETE FROM refresh_tokens WHERE user_id = ? AND token_hash <> ?', [
      req.user.id,
      keep,
    ]);

    res.json({ message: 'Password changed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

auth.post('/profile/avatar', authenticate, handleAvatarUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Choose a picture to upload' });
  const newPath = `/uploads/avatars/${req.file.filename}`;
  try {
    const [rows] = await authPool.query('SELECT avatar FROM users WHERE id = ?', [req.user.id]);
    await authPool.query('UPDATE users SET avatar = ? WHERE id = ?', [newPath, req.user.id]);
    removeAvatarFile(rows[0]?.avatar); 
    res.json({ user: await getUserById(req.user.id) });
  } catch (err) {
    removeAvatarFile(newPath); 
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

auth.delete('/profile/avatar', authenticate, async (req, res) => {
  try {
    const [rows] = await authPool.query('SELECT avatar FROM users WHERE id = ?', [req.user.id]);
    await authPool.query('UPDATE users SET avatar = NULL WHERE id = ?', [req.user.id]);
    removeAvatarFile(rows[0]?.avatar);
    res.json({ user: await getUserById(req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

async function ensureUserColumns() {
  const wanted = {
    username: 'VARCHAR(100) NULL',
    phone: 'VARCHAR(20) NULL',
    avatar: 'VARCHAR(255) NULL',
  };
  try {
    const [rows] = await authPool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
    );
    const have = new Set(rows.map((r) => String(r.COLUMN_NAME).toLowerCase()));
    for (const [col, def] of Object.entries(wanted)) {
      if (!have.has(col)) {
        await authPool.query(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
        console.log(`Added users.${col} column`);
      }
    }
  } catch (err) {
    console.error('Could not check the users table columns:', err.message);
  }
}
ensureUserColumns();

app.use('/api/auth', auth);

if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
}

module.exports = app;
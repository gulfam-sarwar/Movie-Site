

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

if (!process.env.JWT_ACCESS_SECRET) {
  console.error('Missing JWT_ACCESS_SECRET in .env');
  process.exit(1);
}

const dbBase = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
};
const moviesPool = mysql.createPool({ ...dbBase, database: process.env.MOVIES_DB_NAME || 'erdtesting' });
const authPool = mysql.createPool({ ...dbBase, database: process.env.AUTH_DB_NAME || 'jwt_demo' });

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(cookieParser());

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

auth.get('/profile', authenticate, (req, res) => {
  res.json({ message: 'You are logged in', user: req.user });
});

app.use('/api/auth', auth);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
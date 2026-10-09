
require('dotenv').config();
const mysql = require('mysql2/promise');
const axios = require('axios');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.MOVIES_DB_NAME || 'erdtesting',
};

const API_URL = 'https://movies-api.accel.li/api/v2/movie_details.json';
const DELAY_MS = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS movie_details (
  Movie_id          INT NOT NULL PRIMARY KEY,
  imdb_code         VARCHAR(20),
  title_english     VARCHAR(255),
  title_long        VARCHAR(300),
  slug              VARCHAR(300),
  url               VARCHAR(500),
  year              INT,
  rating            DECIMAL(3,1),
  runtime           INT,
  genres            VARCHAR(255),
  language          VARCHAR(20),
  mpa_rating        VARCHAR(20),
  like_count        INT,
  description_intro TEXT,
  description_full  TEXT,
  yt_trailer_code   VARCHAR(50),
  date_uploaded     DATETIME NULL,
  fetched_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`;

const UPSERT = `
INSERT INTO movie_details
  (Movie_id, imdb_code, title_english, title_long, slug, url, year, rating, runtime,
   genres, language, mpa_rating, like_count, description_intro, description_full,
   yt_trailer_code, date_uploaded)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  imdb_code = VALUES(imdb_code), title_english = VALUES(title_english),
  title_long = VALUES(title_long), slug = VALUES(slug), url = VALUES(url),
  year = VALUES(year), rating = VALUES(rating), runtime = VALUES(runtime),
  genres = VALUES(genres), language = VALUES(language), mpa_rating = VALUES(mpa_rating),
  like_count = VALUES(like_count), description_intro = VALUES(description_intro),
  description_full = VALUES(description_full), yt_trailer_code = VALUES(yt_trailer_code),
  date_uploaded = VALUES(date_uploaded)`;

const clip = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

const dateOrNull = (v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(v)
    ? v.replace('T', ' ').slice(0, 19)
    : null;

async function fetchMovie(id) {
  const res = await axios.get(API_URL, {
    params: { movie_id: id, with_images: true, with_cast: true },
    timeout: 20000,
  });
  return res.data?.data?.movie || null;
}

async function main() {
  let conn;
  try {
    conn = await mysql.createConnection(DB_CONFIG);
    console.log('✅ Connected to database.');

    await conn.query(CREATE_TABLE);

    let ids = process.argv.slice(2).map(Number).filter(Boolean);
    if (ids.length === 0) {
      const [rows] = await conn.query('SELECT Movie_id FROM movie ORDER BY Movie_id');
      ids = rows.map((r) => r.Movie_id);
    }
    if (ids.length === 0) {
      console.log('⚠ No movies found in the movie table. Run server.js first.');
      return;
    }
    console.log(`📡 Fetching details for ${ids.length} movies...`);

    let saved = 0;
    let skipped = 0;

    for (const id of ids) {
      try {
        const m = await fetchMovie(id);
        if (!m || !m.id || !m.title) {
          console.warn(`⚠ No details returned for movie ${id}, skipped.`);
          skipped++;
        } else {
          await conn.query(UPSERT, [
            m.id,
            clip(m.imdb_code, 20),
            clip(m.title_english || m.title, 255),
            clip(m.title_long, 300),
            clip(m.slug, 300),
            clip(m.url, 500),
            num(m.year),
            num(m.rating),
            num(m.runtime),
            clip((m.genres || []).join(', '), 255),
            clip(m.language, 20),
            clip(m.mpa_rating, 20),
            num(m.like_count),
            m.description_intro || null,
            m.description_full || m.description_intro || null,
            clip(m.yt_trailer_code, 50),
            dateOrNull(m.date_uploaded),
          ]);
          saved++;
          console.log(`🎬 ${saved}/${ids.length}  ${m.title_long || m.title}`);
        }
      } catch (err) {
        console.warn(`⚠ Movie ${id} failed: ${err.message}`);
        skipped++;
      }
      await sleep(DELAY_MS);
    }

    console.log(`✅ Done. Saved ${saved}, skipped ${skipped}.`);
  } catch (err) {
    console.error('❌ Failure:', err.message);
  } finally {
    if (conn) await conn.end();
  }
}

main();
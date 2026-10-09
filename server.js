
require('dotenv').config();
const mysql = require('mysql2/promise');
const axios = require('axios');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.MOVIES_DB_NAME || 'erdtesting',
};

const API_BASE = 'https://movies-api.accel.li/api/v2';
const MOVIE_LIMIT = 300;
const DELAY_MS = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureImageUrlColumn(conn) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'movie_image' AND LOWER(COLUMN_NAME) = 'image_url'`,
    [DB_CONFIG.database]
  );
  if (rows.length === 0) {
    await conn.query(
      'ALTER TABLE movie_image ADD COLUMN Image_url VARCHAR(500) AFTER Image_type'
    );
    console.log('🛠  Added Image_url column to movie_image.');
  }
}

async function ensureMovieColumns(conn) {
  const wanted = { year: 'INT', genres: 'VARCHAR(255)' };
  for (const [col, type] of Object.entries(wanted)) {
    const [rows] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'movie' AND LOWER(COLUMN_NAME) = ?`,
      [DB_CONFIG.database, col]
    );
    if (rows.length === 0) {
      await conn.query(`ALTER TABLE movie ADD COLUMN ${col} ${type}`);
      console.log(`🛠  Added ${col} column to movie.`);
    }
  }
}

async function fetchCast(movieId) {
  try {
    const res = await axios.get(`${API_BASE}/movie_details.json`, {
      params: { movie_id: movieId, with_cast: true },
      timeout: 20000,
    });
    return res.data?.data?.movie?.cast || [];
  } catch (err) {
    console.warn(`⚠ Could not fetch cast for movie ${movieId}: ${err.message}`);
    return [];
  }
}

async function main() {
  let conn;
  try {
    conn = await mysql.createConnection(DB_CONFIG);
    console.log(`✅ Connected to database as thread ${conn.threadId}`);

    await ensureImageUrlColumn(conn);
    await ensureMovieColumns(conn);

    console.log('📡 Fetching movies from YTS mirror...');
    const response = await axios.get(`${API_BASE}/list_movies.json`, {
      params: { limit: MOVIE_LIMIT },
      timeout: 20000,
    });

    const movies = response.data?.data?.movies;
    if (!Array.isArray(movies) || movies.length === 0) {
      console.log('⚠ Connected, but no movies were returned.');
      return;
    }
    console.log(`🎥 Found ${movies.length} movies. Preparing rows...`);

    const movieRows = [];
    const torrentRows = [];
    const imageRows = [];
    const castRows = [];

    for (const movie of movies) {
      movieRows.push([
        movie.id,
        movie.title || 'Unknown Title',
        movie.rating || 0,
        movie.language || 'en',
        movie.year || null,
        (movie.genres || []).join(', '),
      ]);

      (movie.torrents || []).forEach((t) => {
        torrentRows.push([t.url, t.hash, t.quality, movie.id]);
      });

      const images = {
        small_cover: movie.small_cover_image,
        medium_cover: movie.medium_cover_image,
        large_cover: movie.large_cover_image,
        background: movie.background_image,
        background_original: movie.background_image_original,
      };
      for (const [type, url] of Object.entries(images)) {
        if (url) imageRows.push([type, url, movie.id]);
      }

      const cast = await fetchCast(movie.id);
      cast.forEach((actor) => {
        castRows.push([
          actor.name || 'Unknown',
          actor.character_name || 'Unknown',
          movie.id,
        ]);
      });
      await sleep(DELAY_MS);
    }

    const movieIds = movies.map((m) => m.id);

    await conn.beginTransaction();

    await conn.query(
      `INSERT INTO movie (Movie_id, title, rating, language, year, genres) VALUES ?
       ON DUPLICATE KEY UPDATE title = VALUES(title), rating = VALUES(rating),
       year = VALUES(year), genres = VALUES(genres)`,
      [movieRows]
    );
    console.log(`🎬 MOVIE rows processed: ${movieRows.length}`);

    if (torrentRows.length > 0) {
      await conn.query(
        'INSERT IGNORE INTO torrent (Url, Torrent_hash, quality, Movie_id) VALUES ?',
        [torrentRows]
      );
      console.log(`🧲 TORRENT rows processed: ${torrentRows.length}`);
    }

    if (imageRows.length > 0) {
      await conn.query('DELETE FROM movie_image WHERE Movie_id IN (?)', [movieIds]);
      await conn.query(
        'INSERT INTO movie_image (Image_type, Image_url, Movie_id) VALUES ?',
        [imageRows]
      );
      console.log(`🖼  MOVIE_IMAGE rows inserted: ${imageRows.length}`);
    }

    if (castRows.length > 0) {
      await conn.query('DELETE FROM movie_cast WHERE Movie_id IN (?)', [movieIds]);
      await conn.query(
        'INSERT INTO movie_cast (ActorName, CharacterName, Movie_id) VALUES ?',
        [castRows]
      );
      console.log(`🎭 MOVIE_CAST rows inserted: ${castRows.length}`);
    }

    await conn.commit();
    console.log('✅ All data saved successfully.');
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    console.error('❌ Failure:', err.message);
  } finally {
    if (conn) {
      await conn.end();
      console.log('🔌 Connection closed.');
    }
  }
}

main();
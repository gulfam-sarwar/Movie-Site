const axios = require('axios');
const mysql = require('mysql2/promise'); 


const dbConfig = {
host: 'localhost',
user: 'root', 
password: 'Ighulfam211@',  
database: 'erdtesting'  
}; 

async function importYtsData() {
let connection; 

try {
connection = await mysql.createConnection(dbConfig);
console.log('Successfully connected to the database.'); 

const apiTargetUrl = '[https://yts.mx/api/v2/list_movies.json?limit=10&with_images=true&with_cast=true](https://yts.mx/api/v2/list_movies.json?limit=10&with_images=true&with_cast=true)';
console.log('Contacting YTS API endpoint...');
const apiResponse = await axios.get(apiTargetUrl);

if (apiResponse.data.status !== 'ok') {
throw new Error(   `YTS API error response: ${apiResponse.data.status_message}`);
}

const moviesList = apiResponse.data.data.movies;
if (!moviesList || moviesList.length === 0) {
console.log('No movie entries found to import.');
return;
}

await connection.beginTransaction();
console.log(`Processing ingestion sequence for ${moviesList.length} entities...  `);

for (const movieData of moviesList) {
const { id: movieId, title, rating = 0.0, language = 'English' } = movieData;

const movieSql = `INSERT IGNORE INTO MOVIE (Movie_id, Title, Rating, Language) VALUES (?, ?, ?, ?)`;
await connection.execute(movieSql, [movieId, title, rating, language]);

if (movieData.torrents && Array.isArray(movieData.torrents)) {
const torrentSql = `INSERT IGNORE INTO TORRENT (Torrent_hash, Quality, Url, Movie_id) VALUES (?, ?, ?, ?)`  ;
for (const torrentItem of movieData.torrents) {
await connection.execute(torrentSql, [
torrentItem.hash,
torrentItem.quality,
torrentItem.url,
movieId
]);
}
}

if (movieData.medium_cover_image) {
const generatedImageId = movieId * 10; 
const imageSql = `INSERT IGNORE INTO MOVIE_IMAGE (Image_id, Image_type, Movie_id) VALUES (?, ?, ?)`;
await connection.execute(imageSql, [generatedImageId, 'medium_cover', movieId]);
}

if (movieData.cast && Array.isArray(movieData.cast)) {
const castSql = `INSERT IGNORE INTO MOVIE_CAST (Cast_id, ActorName, CharacterName, Movie_id) VALUES (?, ?, ?, ?)`;
for (let idx = 0; idx < movieData.cast.length; idx++) {
const castMember = movieData.cast[idx];
const generatedCastId = parseInt(`${movieId}${idx}`); 
  await connection.execute(castSql, [
    generatedCastId,
    castMember.name,
    castMember.character_name || 'Unknown Role',
    movieId
  ]);
}

}
}

await connection.commit();
console.log('Data ingestion operation finished successfully!');

} catch (operationError) {
console.error(`An item failed. Rolling back schema transactions:', operationError.message`);
if (connection) {
await connection.rollback();
}
} finally {
if (connection) {
await connection.end();
console.log('Database channel connection safe exit completed.');
}
}
} 

importYtsData();
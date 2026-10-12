import { useEffect, useState } from 'react';
import { API_ROOT } from '../auth';
import './MovieDetail.css';


export default function MovieDetails({ movieId, authFetch, onBack }) {
  const [movie, setMovie] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      setMovie(null);
      try {
        const res = await authFetch(`${API_ROOT}/movies/${movieId}`);
        if (res.status === 404) throw new Error('Movie not found.');
        if (!res.ok) throw new Error('Could not load movie details.');
        const data = await res.json();
        if (!cancelled) setMovie(data);
      } catch (e) {
        if (cancelled) return;
        if (e.message === 'Refresh failed') setError('Your session expired. Please log in again.');
        else if (e instanceof TypeError) setError('Could not reach the server.');
        else setError(e.message || 'Could not load movie details.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [movieId]);

  if (loading) {
    return <main className="md-page"><p className="msg">Loading movie...</p></main>;
  }

  if (error || !movie) {
    return (
      <main className="md-page">
        <button className="md-back" onClick={onBack}>← Back to Movies</button>
        <p className="msg">{error || 'Movie not found.'}</p>
      </main>
    );
  }

  return (
    <main className="md-page">
      <button className="md-back" onClick={onBack}>← Back to Movies</button>

      <div className="md-layout">
        <div className="md-poster">
          {movie.cover ? <img src={movie.cover} alt={movie.title} /> : <div className="noimg">{movie.title}</div>}
        </div>

        <div className="md-info">
          <h1>{movie.title}</h1>
          {movie.title_long && movie.title_long !== movie.title && (
            <p className="md-sub">{movie.title_long}</p>
          )}

          <div className="md-chips">
            {movie.year && <span>{movie.year}</span>}
            {movie.rating != null && <span>★ {movie.rating}</span>}
            {movie.runtime && <span>{movie.runtime} min</span>}
            {movie.language && <span>{movie.language}</span>}
            {movie.mpa_rating && <span>{movie.mpa_rating}</span>}
            {movie.like_count != null && <span>♥ {movie.like_count}</span>}
          </div>

          {movie.genres.length > 0 && (
            <div className="md-chips md-genres">
              {movie.genres.map((g) => <span key={g}>{g}</span>)}
            </div>
          )}

          <section>
            <h2>Overview</h2>
            <p className="md-text">
              {movie.description || 'No description available.'}
            </p>
            {!movie.has_details && (
              <p className="md-hint">
                Full details for this movie aren't in the database yet. Run <code>node fetchDetails.js</code> in the backend folder.
              </p>
            )}
          </section>

          {movie.qualities.length > 0 && (
            <section>
              <h2>Available qualities</h2>
              <div className="md-chips">
                {movie.qualities.map((q) => <span key={q}>{q}</span>)}
              </div>
            </section>
          )}

          {(movie.trailer_code || movie.imdb_code) && (
            <section className="md-links">
              {movie.trailer_code && (
                <a href={`https://www.youtube.com/watch?v=${movie.trailer_code}`} target="_blank" rel="noreferrer">
                  ▶ Watch trailer
                </a>
              )}
              {movie.imdb_code && (
                <a href={`https://www.imdb.com/title/${movie.imdb_code}/`} target="_blank" rel="noreferrer">
                  IMDb
                </a>
              )}
            </section>
          )}

          {movie.cast.length > 0 && (
            <section>
              <h2>Cast</h2>
              <ul className="md-cast">
                {movie.cast.map((c, i) => (
                  <li key={`${c.name}-${i}`}>
                    <strong>{c.name}</strong>
                    {c.character_name && c.character_name !== 'Unknown' && <span> as {c.character_name}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
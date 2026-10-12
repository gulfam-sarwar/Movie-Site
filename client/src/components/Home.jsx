import { useEffect, useState } from 'react';
import '../App.css';
import AuthForm from '../AuthForm';
import ProfilePage from './ProfilePage';
import MovieDetail from './MovieDetails';
import { API_ROOT, refreshAccessToken } from '../auth';

const API = `${API_ROOT}/movies`;
const QUALITIES = ['720p', '1080p', '2160p', '3D'];
const GENRES = ['Action', 'Comedy', 'Drama', 'Horror', 'Romance', 'Thriller', 'Documentary', 'Animation', 'Sci-Fi'];
const RATINGS = [5, 6, 7, 8, 9];
const YEARS = Array.from({ length: 31 }, (_, i) => 2026 - i);
const EMPTY = { search: '', quality: '', genre: '', rating: '', year: '' };

export default function Home() {
  const [filters, setFilters] = useState(EMPTY);
  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [view, setView] = useState('movies');
  const [notice, setNotice] = useState('');
  const [accessToken, setAccessToken] = useState(null);
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  async function authFetch(url, options = {}) {
    const send = (t) =>
      fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${t}` } });
    let res = await send(accessToken);
    if (res.status === 401) {
      const fresh = await refreshAccessToken();
      setAccessToken(fresh);
      res = await send(fresh);
    }
    return res;
  }

  const load = async (f) => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams(Object.entries(f).filter(([, value]) => value)).toString();
      const res = await authFetch(`${API}?${qs}`);
      if (!res.ok) throw new Error('Server error');
      setMovies(await res.json());
    } catch (e) {
      if (e.message === 'Refresh failed') {
        setUser(null);
        setAccessToken(null);
        setMovies([]);
        setError('Your session expired. Please log in again.');
      } else {
        setError('Could not load movies. Is the API running on port 5000?');
      }
    } finally {
      setLoading(false);
    }
  };

  async function startSession(token) {
    const res = await fetch(`${API_ROOT}/auth/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Could not load profile');
    setAccessToken(token);
    setUser((await res.json()).user);
    setView('movies');
  }

  async function saveProfile(values) {
    const res = await authFetch(`${API_ROOT}/auth/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Could not save profile');
    setUser(data.user);
  }
async function uploadAvatar(file) {
  const body = new FormData();
  body.append('avatar', file);
  const res = await authFetch(`${API_ROOT}/auth/profile/avatar`, { method: 'POST', body });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Could not upload picture');
  if (!data.user) throw new Error('Unexpected server response. Restart the API with the new api.js.');
  setUser(data.user);
}

async function removeAvatar() {
  const res = await authFetch(`${API_ROOT}/auth/profile/avatar`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Could not remove picture');
  if (!data.user) throw new Error('Unexpected server response. Restart the API with the new api.js.');
  setUser(data.user);
}

async function changePassword(values) {
  const res = await authFetch(`${API_ROOT}/auth/change-password`, {
    method: 'POST',
    credentials: 'include', 
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Could not change password');
}
  async function logout() {
    try {
      await fetch(`${API_ROOT}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch {}
    setAccessToken(null);
    setUser(null);
    setFilters(EMPTY);
    setSelectedId(null);
    setView('movies');
  }

  useEffect(() => {
    refreshAccessToken()
      .then(startSession)
      .catch(() => {})
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (user) load(EMPTY);
    else setMovies([]);
  }, [user?.id]);

  const go = (v) => (e) => { e.preventDefault(); setNotice(''); setView(v); };
  const openMovie = (id) => { setSelectedId(id); setView('detail'); window.scrollTo(0, 0); };
  const switchAuth = (mode, text = '') => { setNotice(text); setView(mode); };

  const set = (key) => (e) => setFilters({ ...filters, [key]: e.target.value });
  const clear = () => { setFilters(EMPTY); load(EMPTY); };

  const select = (key, label, options) => (
    <select value={filters[key]} onChange={set(key)}>
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o} value={o}>{key === 'rating' ? `${o}+` : o}</option>
      ))}
    </select>
  );

  let content;
  if ((view === 'login' || view === 'register') && !user) {
    content = (
      <AuthForm key={view} mode={view} notice={notice} onSwitch={switchAuth} onLoggedIn={startSession} />
    );
  } else if (booting) {
    content = <main><p className="msg">Loading...</p></main>;
  } else if (!user) {
    content = (
      <div className="gate">
        <h2>Please log in to watch movies</h2>
        <p>{error || 'You need an account to browse the movie library.'}</p>
        <div className="gate-actions">
          <button className="primary" onClick={() => switchAuth('login')}>Login</button>
          <button onClick={() => switchAuth('register')}>Register</button>
        </div>
      </div>
    );
  } else if (view === 'profile') {
    content = (
     <ProfilePage
        user={user}
        onBack={() => setView('movies')}
        onSave={saveProfile}
        onUploadAvatar={uploadAvatar}
        onRemoveAvatar={removeAvatar}
        onChangePassword={changePassword}
        onLogout={logout}
      />
    );
  } else if (view === 'detail' && selectedId) {
    content = (
      <MovieDetail
        movieId={selectedId}
        authFetch={authFetch}
        onBack={() => setView('movies')}
      />
    );
  } else {
    content = (
      <>
        <div className="searchbar">
          <input
            placeholder="Search movies"
            value={filters.search}
            onChange={set('search')}
            onKeyDown={(e) => e.key === 'Enter' && load(filters)}
          />
          {select('quality', 'Quality', QUALITIES)}
          {select('genre', 'Genre', GENRES)}
          {select('rating', 'Rating', RATINGS)}
          {select('year', 'Year', YEARS)}
          <button className="btn-search" onClick={() => load(filters)}>Search</button>
          <button className="btn-clear" onClick={clear}>Clear</button>
        </div>

        <main>
          {loading && <p className="msg">Loading...</p>}
          {error && <p className="msg">{error}</p>}
          {!loading && !error && movies.length === 0 && <p className="msg">No movies found.</p>}

          <div className="grid">
            {movies.map((m) => (
              <div
                className="card"
                key={m.id}
                role="button"
                tabIndex={0}
                onClick={() => openMovie(m.id)}
                onKeyDown={(e) => e.key === 'Enter' && openMovie(m.id)}
              >
                {m.cover ? <img src={m.cover} alt={m.title} /> : <div className="noimg">{m.title}</div>}
                <div className="title">{m.title}</div>
                <div className="meta">{m.year || '—'} • ★ {m.rating ?? 0}</div>
              </div>
            ))}
          </div>
        </main>
      </>
    );
  }

  return (
    <div className="app">
      <header className="nav">
        <div className="logo">NETFLIX</div>

          <nav>
          {user && (
            <>
              <a href="#" onClick={go('movies')}>Home</a>
              <a href="#">4K</a>
              <a href="#">Trending</a>
              <a href="#" onClick={go('movies')}>Browse Movies</a>
            </>
          )}
          {!booting && (user ? (
            <>
              <a href="#" onClick={go('profile')}>Profile</a>
              <span className="user">{user.email}</span>
              <a href="#" className="login" onClick={(e) => { e.preventDefault(); logout(); }}>Logout</a>
            </>
          ) : (
            <>
              <a href="#" className="login" onClick={go('login')}>Login</a>
              <span>|</span>
              <a href="#" className="register" onClick={go('register')}>Register</a>
            </>
          ))}
        </nav>
      </header>

      {content}
      {/* <ProfilePage
        user={user}
        onBack={() => setView('movies')}
        onSave={saveProfile}
        onUploadAvatar={uploadAvatar}
        onRemoveAvatar={removeAvatar}
        onChangePassword={changePassword}
        onLogout={logout}
      /> */}
    </div>
  );
}
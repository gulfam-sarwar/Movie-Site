import { useState } from 'react';
import { API_ROOT } from './auth';
import './auth.css';

export default function AuthForm({ mode, notice, onSwitch, onLoggedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(notice ? { type: 'ok', text: notice } : null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch(`${API_ROOT}/auth/${mode}`, {
        method: 'POST',
        credentials: 'include', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: 'error', text: data.message || 'Something went wrong' });
      } else if (mode === 'register') {
        onSwitch('login', 'Account created. Log in to continue.');
      } else {
        await onLoggedIn(data.accessToken);
      }
    } catch {
      setMessage({ type: 'error', text: "Can't reach the server. Is the API running on port 5000?" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>{mode === 'login' ? 'Log in' : 'Create account'}</h1>

      <form onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={6}
            required
          />
        </label>

        {message && <p className={`form-msg ${message.type}`}>{message.text}</p>}

        <button type="submit" className="auth-submit" disabled={loading}>
          {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>

      <p className="auth-switch">
        {mode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
        <button
          type="button"
          className="auth-link"
          onClick={() => onSwitch(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? 'Create an account' : 'Log in'}
        </button>
      </p>
    </div>
  );
}
import { useState } from "react";
import "./ProfilePage.css";

export default function ProfilePage({ user, onBack, onLogout,   onSave }) {
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState(user.username || "");
  const [phone, setPhone] = useState(user.phone || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const initial = (user.username || user.email || "?").charAt(0).toUpperCase();

  function startEdit() {
    setUsername(user.username || "");
    setPhone(user.phone || "");
    setMessage(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setMessage(null);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await onSave({ username, phone });
      setEditing(false);
      setMessage({ type: "ok", text: "Profile updated." });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="profile-card">
      <div className="avatar">{initial}</div>
      
      
      <h1>My Profile</h1>

      {message && <p className={`form-msg ${message.type}`}>{message.text}</p>}

      {editing ? (
        <form onSubmit={handleSave}>
          <dl>
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <p className="hint">Email can't be changed here.</p>

            <dt>Username</dt>
            <dd>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={100}
                placeholder="Your name"
                disabled={saving}
              />
            </dd>

            <dt>Phone No.</dt>
            <dd>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+92 300 1234567"
                disabled={saving}
              />
            </dd>

            <dt>User ID</dt>
            <dd>{user.id}</dd>
          </dl>

          <div className="gate-actions">
            <button type="submit" className="primary" disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </button>
            <button type="button" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <dl>
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Username</dt>
            <dd className={user.username ? "" : "empty"}>{user.username || "Not set"}</dd>
            <dt>Phone No.</dt>
            <dd className={user.phone ? "" : "empty"}>{user.phone || "Not set"}</dd>
            <dt>User ID</dt>
            <dd>{user.id}</dd>
          </dl>

          <div className="gate-actions">
            <button className="primary" onClick={startEdit}>Edit profile</button>
            <button onClick={onBack}>Back to movies</button>
            <button onClick={onLogout}>Logout</button>
          </div>
        </>
      )}
    </div>
  );
}
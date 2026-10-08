import "./ProfilePage.css";
export default function ProfilePage({ user, onBack, onLogout }) {
  const initial = (user.email || '?').charAt(0).toUpperCase();

  return (
    <div className="profile-card">
      <div className="avatar">{initial}</div>
      <h1>My Profile</h1>

      <dl>
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Username</dt>
        <dd>Gulfam Sarwar</dd>
        <dt>Phone No.</dt>
         <dd>+923026158235</dd>
        <dt>User ID</dt>
        <dd>{user.id}</dd>
      </dl>

      <div className="gate-actions">
        <button className="primary" onClick={onBack}>Back to movies</button>
        <button onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
}
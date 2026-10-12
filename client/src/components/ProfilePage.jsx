
import { useRef, useState } from "react";
import { API_ROOT } from "../auth";
import "./ProfilePage.css";


const FILE_ROOT = API_ROOT.replace(/\/api\/?$/, "");
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export default function ProfilePage(props) {
  if (!props.user) return null;
  return <ProfileDetails {...props} />;
}

function ProfileDetails({
  user,
  onBack,
  onLogout,
  onSave,
  onUploadAvatar,
  onRemoveAvatar,
  onChangePassword,
}) {
  const [mode, setMode] = useState("view");
  const [username, setUsername] = useState(user.username || "");
  const [phone, setPhone] = useState(user.phone || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [message, setMessage] = useState(null);
  const fileInput = useRef(null);

  const initial = (user.username || user.email || "?").charAt(0).toUpperCase();
  const avatarSrc = user.avatar && !imgFailed ? `${FILE_ROOT}${user.avatar}` : null;
  const busy = saving || avatarBusy;

  function startEdit() {
    setUsername(user.username || "");
    setPhone(user.phone || "");
    setMessage(null);
    setMode("edit");
  }

  function startPassword() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowPasswords(false);
    setMessage(null);
    setMode("password");
  }

  function cancel() {
    setMode("view");
    setMessage(null);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await onSave({ username, phone });
      setMode("view");
      setMessage({ type: "ok", text: "Profile updated." });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handlePassword(e) {
    e.preventDefault();
    setMessage(null);

    if (newPassword.length < 6) {
      return setMessage({ type: "error", text: "New password must be at least 6 characters." });
    }
    if (newPassword !== confirmPassword) {
      return setMessage({ type: "error", text: "New password and confirmation don't match." });
    }
    if (newPassword === currentPassword) {
      return setMessage({ type: "error", text: "New password must be different from the current one." });
    }

    setSaving(true);
    try {
      await onChangePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMode("view");
      setMessage({ type: "ok", text: "Password changed. Your other devices were signed out." });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; 
    if (!file) return;

    if (!AVATAR_TYPES.includes(file.type)) {
      return setMessage({ type: "error", text: "Choose a JPG, PNG, WEBP or GIF picture." });
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return setMessage({ type: "error", text: "Picture must be 2 MB or smaller." });
    }

    setAvatarBusy(true);
    setMessage(null);
    try {
      await onUploadAvatar(file);
      setImgFailed(false);
      setMessage({ type: "ok", text: "Profile picture updated." });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleRemoveAvatar() {
    setAvatarBusy(true);
    setMessage(null);
    try {
      await onRemoveAvatar();
      setMessage({ type: "ok", text: "Profile picture removed." });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setAvatarBusy(false);
    }
  }

  return (
    <div className="profile-card">
      <div className="avatar">
        {avatarSrc ? (
          <img src={avatarSrc} alt="Profile" onError={() => setImgFailed(true)} />
        ) : (
          initial
        )}
      </div>

      {mode !== "password" && (
        <div className="avatar-actions">
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleFile}
            hidden
          />
          <button type="button" className="link-btn" onClick={() => fileInput.current.click()} disabled={busy}>
            {avatarBusy ? "Working..." : user.avatar ? "Change photo" : "Upload photo"}
          </button>
          {user.avatar && (
            <button type="button" className="link-btn danger" onClick={handleRemoveAvatar} disabled={busy}>
              Remove
            </button>
          )}
        </div>
      )}

      <h1>{mode === "password" ? "Change Password" : "My Profile"}</h1>

      {message && <p className={`form-msg ${message.type}`}>{message.text}</p>}

      {mode === "edit" && (
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
            <button type="button" onClick={cancel} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === "password" && (
        <form onSubmit={handlePassword}>
          <div className="pw-form">
            <label>
              Current password
              <input
                type={showPasswords ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={saving}
              />
            </label>
            <label>
              New password
              <input
                type={showPasswords ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
                disabled={saving}
              />
            </label>
            <label>
              Confirm new password
              <input
                type={showPasswords ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
                disabled={saving}
              />
            </label>
            <label className="pw-show">
              <input
                type="checkbox"
                checked={showPasswords}
                onChange={(e) => setShowPasswords(e.target.checked)}
              />
              Show passwords
            </label>
          </div>

          <div className="gate-actions">
            <button type="submit" className="primary" disabled={saving}>
              {saving ? "Updating..." : "Update password"}
            </button>
            <button type="button" onClick={cancel} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === "view" && (
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
            <button className="primary" onClick={startEdit} disabled={busy}>Edit profile</button>
            <button onClick={startPassword} disabled={busy}>Change password</button>
            <button onClick={onBack}>Back to movies</button>
            <button onClick={onLogout}>Logout</button>
          </div>
        </>
      )}
    </div>
  );
}
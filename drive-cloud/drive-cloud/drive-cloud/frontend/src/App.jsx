import React, { useEffect, useRef, useState } from 'react';
import { api, setToken } from './api.js';

const fmtSize = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB');
const fmtDate = (d) => new Date(d).toLocaleDateString();

/* ---------- Login / Register ---------- */
function Auth({ onDone }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const d = await api('/auth/' + mode, { method: 'POST', body: f });
      setToken(d.token);
      localStorage.setItem('user', JSON.stringify(d.user));
      onDone(d.user);
    } catch (x) { setErr(x.message); }
  };

  return (
    <form className="panel auth" onSubmit={submit}>
      <h1>{mode === 'login' ? 'Log in' : 'Create account'}</h1>
      {mode === 'register' && <input placeholder="Full name" value={f.name} onChange={set('name')} required />}
      <input type="email" placeholder="Email" value={f.email} onChange={set('email')} required />
      <input type="password" placeholder="Password" value={f.password} onChange={set('password')} required />
      {err && <p className="error">{err}</p>}
      <button className="primary">{mode === 'login' ? 'Log in' : 'Create account'}</button>
      <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in'}
      </button>
    </form>
  );
}

/* ---------- Drive ---------- */
function Drive() {
  const [data, setData] = useState({ mine: [], shared: [] });
  const [usage, setUsage] = useState({ used: 0, quota: 1 });
  const [msg, setMsg] = useState({ text: '', error: false });
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef();

  const load = () => {
    api('/files').then(setData).catch((e) => say(e.message, true));
    api('/usage').then(setUsage).catch(() => {});
  };
  useEffect(load, []);
  const say = (text, error = false) => setMsg({ text, error });
  const run = async (fn) => { try { await fn(); } catch (e) { say(e.message, true); } };

  const upload = (e) => run(async () => {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true); say('');
    const fd = new FormData();
    fd.append('file', file);
    try { await api('/files', { method: 'POST', body: fd }); say(`Uploaded ${file.name}.`); load(); }
    finally { setBusy(false); input.current.value = ''; }
  });

  const download = (f) => run(async () => {
    const blob = await api(`/files/${f._id}/download`, { raw: true });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.name;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const remove = (f) => window.confirm(`Delete ${f.name}?`) &&
    run(async () => { await api('/files/' + f._id, { method: 'DELETE' }); load(); });

  const share = (f) => {
    const email = window.prompt('Share with (their account email):');
    if (email) run(async () => { const d = await api(`/files/${f._id}/share`, { method: 'POST', body: { email } }); say(`Shared with ${d.shared}.`); load(); });
  };

  const unshare = (f, u) => run(async () => { await api(`/files/${f._id}/share/${u._id}`, { method: 'DELETE' }); load(); });

  const makeLink = (f) => run(async () => {
    const d = await api(`/files/${f._id}/link`, { method: 'POST', body: { days: 1 } });
    setLink(`${location.origin}/api/public/${d.token}`);
    say(`Link for ${f.name} works until ${new Date(d.expires).toLocaleString()}.`);
    load();
  });

  const revoke = (f) => run(async () => { await api(`/files/${f._id}/link`, { method: 'DELETE' }); setLink(''); load(); });

  const pct = Math.min(100, (usage.used / usage.quota) * 100);

  return (
    <>
      <section className="panel">
        <div className="row between">
          <h2>My files</h2>
          <label className={'primary button' + (busy ? ' disabled' : '')}>
            {busy ? 'Uploading...' : 'Upload a file'}
            <input ref={input} type="file" onChange={upload} disabled={busy} hidden />
          </label>
        </div>
        <div className="meter" role="img" aria-label={`${pct.toFixed(0)}% of storage used`}><div style={{ width: pct + '%' }} /></div>
        <p className="muted">{fmtSize(usage.used)} of {fmtSize(usage.quota)} used. Files up to {fmtSize(usage.maxFile || 0)}.</p>
        {msg.text && <p className={msg.error ? 'error' : 'muted'}>{msg.text}</p>}
        {link && <input className="linkbox" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Public link" />}

        {data.mine.length === 0 ? <p className="muted">No files yet. Upload your first file.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Size</th><th>Added</th><th></th></tr></thead>
            <tbody>
              {data.mine.map((f) => (
                <tr key={f._id}>
                  <td>
                    {f.name}
                    {f.sharedWith.length > 0 && (
                      <div className="muted small">Shared with {f.sharedWith.map((u) => (
                        <span key={u._id} className="chipx">{u.email} <button className="link" title="Stop sharing" onClick={() => unshare(f, u)}>×</button></span>
                      ))}</div>
                    )}
                    {f.shareToken && new Date(f.shareExpires) > new Date() && <div className="muted small">Public link active <button className="link" onClick={() => revoke(f)}>Turn off</button></div>}
                  </td>
                  <td>{fmtSize(f.size)}</td><td>{fmtDate(f.createdAt)}</td>
                  <td className="actions">
                    <button onClick={() => download(f)}>Download</button>
                    <button onClick={() => share(f)}>Share</button>
                    <button onClick={() => makeLink(f)}>Get link</button>
                    <button onClick={() => remove(f)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Shared with me</h2>
        {data.shared.length === 0 ? <p className="muted">Nothing has been shared with you yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>From</th><th>Size</th><th></th></tr></thead>
            <tbody>
              {data.shared.map((f) => (
                <tr key={f._id}><td>{f.name}</td><td>{f.owner?.name}</td><td>{fmtSize(f.size)}</td>
                  <td className="actions"><button onClick={() => download(f)}>Download</button></td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

/* ---------- App shell ---------- */
export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const logout = () => { setToken(''); localStorage.removeItem('user'); setUser(null); };

  if (!user) return <main><Auth onDone={setUser} /></main>;
  return (
    <main>
      <header>
        <strong>Cloud Drive</strong>
        <span>{user.name} <button className="link" onClick={logout}>Log out</button></span>
      </header>
      <Drive />
    </main>
  );
}

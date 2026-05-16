import React, { useContext, useEffect, useRef, useState } from 'react';
import { ToastContext } from '../App.jsx';
import { api } from '../api.js';

const SPK_COLOURS = [
  '#388bfd','#3fb950','#d29922','#f78166','#a5d6ff',
  '#7ee787','#ffa657','#ff7b72','#d2a8ff','#79c0ff',
];
function spkColour(label) {
  let h = 0;
  for (let i = 0; i < (label||'').length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return SPK_COLOURS[h % SPK_COLOURS.length];
}

export default function Speakers() {
  const toast = useContext(ToastContext);

  const [speakers, setSpeakers]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting]   = useState(null);
  const [file, setFile]           = useState(null);
  const [name, setName]           = useState('');
  const [label, setLabel]         = useState('');
  const fileRef = useRef();

  useEffect(() => {
    api.get('/speakers')
      .then(s => { setSpeakers(Array.isArray(s) ? s : []); setLoading(false); })
      .catch(() => { toast('Failed to load speakers', 'error'); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enroll(e) {
    e.preventDefault();
    if (!file)       { toast('Select an audio file', 'warn'); return; }
    if (!name.trim()) { toast('Name is required', 'warn'); return; }
    if (!label.trim()) { toast('Label (e.g. SPEAKER_00) is required', 'warn'); return; }

    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', name);
    fd.append('label', label);
    try {
      const spk = await api.form('/speakers', fd);
      setSpeakers(s => [...s, spk]);
      setFile(null);
      setName('');
      setLabel('');
      if (fileRef.current) fileRef.current.value = '';
      toast(`Speaker "${spk.name}" enrolled`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  }

  async function deleteSpeaker(id) {
    if (!confirm('Remove this speaker profile?')) return;
    setDeleting(id);
    try {
      await api.delete(`/speakers/${id}`);
      setSpeakers(s => s.filter(x => x.id !== id));
      toast('Speaker removed', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDeleting(null);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }

  if (loading) return <div className="empty">Loading…</div>;

  return (
    <>
      <div className="page-hdr">
        <div>
          <h1>Speaker Profiles</h1>
          <p>Enroll voice samples for automatic speaker identification during meetings</p>
        </div>
      </div>

      <div className="two-col">
        {/* Enroll form */}
        <div className="card">
          <div className="card-hdr">Enroll New Speaker</div>
          <form className="form-card" onSubmit={enroll}>
            <div className="form-group">
              <label className="form-label">Speaker Name <span className="req">*</span></label>
              <input
                className="form-input"
                placeholder="e.g. Dr. Ahmed Khan"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                Diarization Label <span className="req">*</span>
                <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>e.g. SPEAKER_00</span>
              </label>
              <input
                className="form-input"
                placeholder="SPEAKER_00"
                value={label}
                onChange={e => setLabel(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Voice Sample <span className="req">*</span></label>
              <div
                className="file-drop"
                onClick={() => fileRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={e => e.preventDefault()}
              >
                <div className="file-drop-icon">🎵</div>
                <div className="file-drop-text">
                  {file ? file.name : 'Click or drag a WAV/MP3 file'}
                </div>
                <div className="file-drop-hint">Minimum 10–30 seconds of clean speech recommended</div>
                {file && <div className="file-drop-name">{(file.size / 1024).toFixed(0)} KB</div>}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                style={{ display: 'none' }}
                onChange={e => setFile(e.target.files[0] || null)}
              />
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" disabled={uploading}>
                {uploading ? 'Enrolling…' : '+ Enroll Speaker'}
              </button>
            </div>
          </form>
        </div>

        {/* Speaker list */}
        <div className="card">
          <div className="card-hdr">
            Enrolled Speakers
            <span className="badge">{speakers.length}</span>
          </div>
          {speakers.length === 0 ? (
            <div className="empty">No speakers enrolled yet</div>
          ) : (
            speakers.map(spk => {
              const col = spkColour(spk.label || spk.name);
              return (
                <div key={spk.id} className="spk-item">
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div className="spk-avatar" style={{ background: col }}>
                      {(spk.name || 'S').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{spk.name}</div>
                      <div className="mono muted">{spk.label}</div>
                    </div>
                  </div>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={deleting === spk.id}
                    onClick={() => deleteSpeaker(spk.id)}
                  >
                    {deleting === spk.id ? '…' : 'Remove'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

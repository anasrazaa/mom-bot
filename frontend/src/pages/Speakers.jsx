import React, { useContext, useEffect, useRef, useState } from 'react';
import { ToastContext } from '../App.jsx';
import { api } from '../api.js';

const SPK_COLOURS = ['#388bfd','#3fb950','#d29922','#f78166','#a5d6ff','#7ee787','#ffa657','#ff7b72','#d2a8ff','#79c0ff'];
function spkColour(name) {
  let h = 0;
  for (let i = 0; i < (name||'').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SPK_COLOURS[h % SPK_COLOURS.length];
}

/* Enrollment phrase — bilingual Urdu + English for broad phoneme coverage */
const ENROLLMENT_PHRASE = [
  { ur: 'بسم اللہ الرحمن الرحیم۔ میرا نام _____ ہے۔', en: 'In the name of Allah, the Most Gracious. My name is _____ .' },
  { ur: 'میں GIK انسٹیٹیوٹ آف انجینئرنگ سائنسز میں پڑھاتا ہوں۔', en: 'I teach at GIK Institute of Engineering Sciences and Technology.' },
  { ur: 'تعلیم ایک عظیم فریضہ ہے جو ہمیں آگے بڑھنے میں مدد دیتی ہے۔', en: 'Education is a great responsibility that helps us move forward in life.' },
  { ur: 'آج کا دن بہت اچھا ہے اور میں اپنے طلباء کو پڑھانے کا شوق رکھتا ہوں۔', en: 'Today is a great day and I enjoy teaching my students at this institution.' },
];

export default function Speakers() {
  const toast = useContext(ToastContext);

  const [speakers, setSpeakers]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [uploading, setUploading]   = useState(false);
  const [deleting, setDeleting]     = useState(null);
  const [name, setName]             = useState('');
  const [mode, setMode]             = useState('record'); // 'record' | 'upload'

  /* Upload mode */
  const [file, setFile]             = useState(null);
  const fileRef                     = useRef();

  /* Record mode */
  const [recording, setRecording]   = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordSec, setRecordSec]   = useState(0);
  const [audioUrl, setAudioUrl]     = useState(null);
  const mediaRecRef                 = useRef(null);
  const chunksRef                   = useRef([]);
  const timerRef                    = useRef(null);
  const streamRef                   = useRef(null);

  useEffect(() => {
    api.get('/speaker/')
      .then(r => { setSpeakers(r.speakers || []); setLoading(false); })
      .catch(() => { toast('Failed to load speakers', 'error'); setLoading(false); });
    return () => stopRecording();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Recording ─────────────────────────────────────────────────────────── */
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        .catch(err => {
          if (err.name === 'NotAllowedError') throw new Error('Microphone access denied. Allow mic in your browser and try again.');
          throw err;
        });
      streamRef.current = stream;
      chunksRef.current = [];

      const mr = new MediaRecorder(stream, { mimeType: getSupportedMime() });
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        setRecordedBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start(250);
      mediaRecRef.current = mr;
      setRecording(true);
      setRecordSec(0);
      setRecordedBlob(null);
      setAudioUrl(null);
      timerRef.current = setInterval(() => setRecordSec(s => s + 1), 1000);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function stopRecording() {
    if (mediaRecRef.current?.state === 'recording') mediaRecRef.current.stop();
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    setRecording(false);
  }

  function discardRecording() {
    stopRecording();
    setRecordedBlob(null);
    setAudioUrl(null);
    setRecordSec(0);
  }

  /* ── Enroll ─────────────────────────────────────────────────────────────── */
  async function enroll(e) {
    e.preventDefault();
    if (!name.trim()) { toast('Name is required', 'warn'); return; }

    const audioFile = mode === 'record'
      ? (recordedBlob ? new File([recordedBlob], 'voice-sample.webm', { type: recordedBlob.type }) : null)
      : file;

    if (!audioFile) {
      toast(mode === 'record' ? 'Record your voice first' : 'Select an audio file', 'warn');
      return;
    }
    if (mode === 'record' && recordSec < 5) {
      toast('Recording too short — please read the full phrase (at least 5 seconds)', 'warn');
      return;
    }

    setUploading(true);
    const fd = new FormData();
    fd.append('audio', audioFile);
    fd.append('name', name);
    try {
      await api.form('/speaker/enroll', fd);
      setSpeakers(s => [...s, name]);
      setName('');
      setFile(null);
      discardRecording();
      if (fileRef.current) fileRef.current.value = '';
      toast(`Speaker "${name}" enrolled successfully`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  }

  async function deleteSpeaker(spkName) {
    if (!confirm(`Remove speaker "${spkName}"?`)) return;
    setDeleting(spkName);
    try {
      await api.delete(`/speaker/${encodeURIComponent(spkName)}`);
      setSpeakers(s => s.filter(x => x !== spkName));
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

  const canSubmit = mode === 'record' ? (!!recordedBlob && !recording) : !!file;

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
        {/* ── Enroll form ──────────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-hdr">Enroll New Speaker</div>
          <form className="form-card" onSubmit={enroll}>

            <div className="form-group">
              <label className="form-label">Speaker Name <span className="req">*</span></label>
              <input className="form-input" placeholder="e.g. Dr. Ahmed Khan"
                value={name} onChange={e => setName(e.target.value)} />
            </div>

            {/* Mode toggle */}
            <div className="form-group">
              <label className="form-label">Voice Sample Method</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <ModeBtn active={mode === 'record'} onClick={() => { setMode('record'); discardRecording(); setFile(null); }}>
                  🎙 Record Now
                </ModeBtn>
                <ModeBtn active={mode === 'upload'} onClick={() => { setMode('upload'); discardRecording(); }}>
                  📁 Upload File
                </ModeBtn>
              </div>
            </div>

            {/* ── Record mode ─────────────────────────────────────────────── */}
            {mode === 'record' && (
              <>
                <EnrollmentPhrase speakerName={name} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
                  {!recordedBlob ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <button type="button"
                        className={`mic-btn ${recording ? 'active' : 'idle'}`}
                        onClick={() => recording ? stopRecording() : startRecording()}>
                        {recording ? '⏹' : '🎙'}
                      </button>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>
                          {recording ? `Recording… ${fmtSec(recordSec)}` : 'Click to start recording'}
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {recording
                            ? 'Read the phrase above clearly, then click stop'
                            : 'Browser will ask for microphone permission'}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ background: 'var(--c-surface2)', borderRadius: 8, padding: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: 'var(--c-success)', fontSize: 18 }}>✓</span>
                          <span style={{ fontWeight: 600, fontSize: 14 }}>Recording captured ({fmtSec(recordSec)})</span>
                        </div>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={discardRecording}>
                          ✕ Discard
                        </button>
                      </div>
                      {audioUrl && (
                        <audio controls src={audioUrl}
                          style={{ width: '100%', height: 36, borderRadius: 6 }} />
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ── Upload mode ─────────────────────────────────────────────── */}
            {mode === 'upload' && (
              <div className="form-group">
                <label className="form-label">Audio File <span className="req">*</span></label>
                <div className="file-drop"
                  onClick={() => fileRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}>
                  <div className="file-drop-icon">🎵</div>
                  <div className="file-drop-text">{file ? file.name : 'Click or drag a WAV / MP3 file'}</div>
                  <div className="file-drop-hint">10–30 seconds of clean speech recommended</div>
                  {file && <div className="file-drop-name">{(file.size / 1024).toFixed(0)} KB</div>}
                </div>
                <input ref={fileRef} type="file" accept="audio/*" style={{ display: 'none' }}
                  onChange={e => setFile(e.target.files[0] || null)} />
              </div>
            )}

            <div className="form-actions">
              <button className="btn btn-primary" disabled={uploading || !canSubmit || !name.trim()}>
                {uploading ? 'Enrolling…' : '+ Enroll Speaker'}
              </button>
            </div>
          </form>
        </div>

        {/* ── Enrolled list ─────────────────────────────────────────────────── */}
        <div className="card">
          <div className="card-hdr">
            Enrolled Speakers
            <span className="badge">{speakers.length}</span>
          </div>
          {speakers.length === 0 ? (
            <div className="empty">No speakers enrolled yet</div>
          ) : (
            speakers.map(spkName => (
              <div key={spkName} className="spk-item">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div className="spk-avatar" style={{ background: spkColour(spkName) }}>
                    {spkName.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{spkName}</div>
                </div>
                <button className="btn btn-danger btn-sm"
                  disabled={deleting === spkName} onClick={() => deleteSpeaker(spkName)}>
                  {deleting === spkName ? '…' : 'Remove'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

/* ── Enrollment phrase card ───────────────────────────────────────────────── */
function EnrollmentPhrase({ speakerName }) {
  return (
    <div style={{
      background: 'rgba(31,111,235,.08)', border: '1px solid rgba(31,111,235,.25)',
      borderRadius: 10, padding: '16px 18px', marginBottom: 18,
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--c-accent)', marginBottom: 12 }}>
        📖 Read this phrase aloud — clearly and naturally
      </div>
      {ENROLLMENT_PHRASE.map((p, i) => (
        <div key={i} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 16, lineHeight: 2, color: 'var(--c-text)', direction: 'rtl', textAlign: 'right', fontFamily: 'serif' }}>
            {p.ur.replace('_____', speakerName || '_____')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--c-muted)', lineHeight: 1.6, marginTop: 2 }}>
            {p.en.replace('_____', speakerName || '_____')}
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: 'var(--c-muted)', borderTop: '1px solid var(--c-border)', paddingTop: 10, marginTop: 4 }}>
        💡 Speak each line at a natural pace. Avoid background noise for best identification accuracy.
      </div>
    </div>
  );
}

/* ── Mode toggle button ───────────────────────────────────────────────────── */
function ModeBtn({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        flex: 1, padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
        fontWeight: 600, fontSize: 13, transition: 'all .15s',
        background: active ? 'var(--c-primary)' : 'var(--c-surface2)',
        color: active ? '#fff' : 'var(--c-muted)',
        border: active ? '1px solid var(--c-primary)' : '1px solid var(--c-border)',
      }}>
      {children}
    </button>
  );
}

function fmtSec(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function getSupportedMime() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

import React, { useContext, useEffect, useRef, useState } from 'react';
import { ToastContext } from '../App.jsx';
import { api } from '../api.js';

const SPK_COLOURS = ['#388bfd','#3fb950','#d29922','#f78166','#a5d6ff','#7ee787','#ffa657','#ff7b72','#d2a8ff','#79c0ff'];
const MAX_SAMPLES = 5;
const MIN_ENROLL_SAMPLES = 3;

function spkColour(name) {
  let h = 0;
  for (let i = 0; i < (name||'').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SPK_COLOURS[h % SPK_COLOURS.length];
}

/* Different phrases for each recording so the model sees phonetic variety */
const ENROLLMENT_PHRASES = [
  {
    label: 'Sample 1 — Introduction',
    ur: 'بسم اللہ الرحمن الرحیم۔ میرا نام _____ ہے اور میں GIK انسٹیٹیوٹ میں پڑھاتا ہوں۔',
    en: 'In the name of Allah. My name is _____ and I teach at GIK Institute.',
  },
  {
    label: 'Sample 2 — Meeting context',
    ur: 'آج کی میٹنگ میں ہم اہم تعلیمی امور پر تبادلہ خیال کریں گے۔ شکریہ۔',
    en: 'In today\'s meeting we will discuss important academic matters. Thank you.',
  },
  {
    label: 'Sample 3 — Free speech',
    ur: 'تعلیم ایک عظیم ذمہ داری ہے۔ ہمیں اپنے طلباء کی بہترین تربیت کرنی چاہیے۔',
    en: 'Education is a great responsibility. We must provide the best training to our students.',
  },
];

function getSupportedMime() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function fmtSec(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function Speakers() {
  const toast = useContext(ToastContext);

  const [speakers, setSpeakers]         = useState([]);
  const [sampleCounts, setSampleCounts] = useState({});
  const [loading, setLoading]           = useState(true);
  const [deleting, setDeleting]         = useState(null);
  const [name, setName]                 = useState('');
  const [mode, setMode]                 = useState('record'); // 'record' | 'upload'
  const [enrolling, setEnrolling]       = useState(false);

  /* Multi-sample record state */
  const [samples, setSamples]           = useState([]); // [{blob, url, sec}]
  const [recording, setRecording]       = useState(false);
  const [currentBlob, setCurrentBlob]   = useState(null);
  const [currentUrl, setCurrentUrl]     = useState(null);
  const [recordSec, setRecordSec]       = useState(0);
  const mediaRecRef                     = useRef(null);
  const chunksRef                       = useRef([]);
  const timerRef                        = useRef(null);
  const streamRef                       = useRef(null);

  /* Upload mode */
  const [uploadFile, setUploadFile]     = useState(null);
  const fileRef                         = useRef();

  const currentStep = samples.length; // 0, 1, 2 → which phrase to show

  useEffect(() => {
    fetchSpeakers();
    return () => stopRecording();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fetchSpeakers() {
    api.get('/speaker/')
      .then(r => {
        setSpeakers(r.speakers || []);
        setSampleCounts(r.sample_counts || {});
        setLoading(false);
      })
      .catch(() => { toast('Failed to load speakers', 'error'); setLoading(false); });
  }

  /* ── Recording ─────────────────────────────────────────────────────────── */
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        .catch(err => {
          if (err.name === 'NotAllowedError') throw new Error('Microphone access denied.');
          throw err;
        });
      streamRef.current = stream;
      chunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: getSupportedMime() });
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        setCurrentBlob(blob);
        setCurrentUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start(250);
      mediaRecRef.current = mr;
      setRecording(true);
      setRecordSec(0);
      setCurrentBlob(null);
      setCurrentUrl(null);
      timerRef.current = setInterval(() => setRecordSec(s => s + 1), 1000);
    } catch (err) { toast(err.message, 'error'); }
  }

  function stopRecording() {
    if (mediaRecRef.current?.state === 'recording') mediaRecRef.current.stop();
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    setRecording(false);
  }

  function acceptSample() {
    if (!currentBlob) return;
    setSamples(prev => [...prev, { blob: currentBlob, url: currentUrl, sec: recordSec }]);
    setCurrentBlob(null);
    setCurrentUrl(null);
    setRecordSec(0);
  }

  function discardCurrent() {
    stopRecording();
    setCurrentBlob(null);
    setCurrentUrl(null);
    setRecordSec(0);
  }

  function removeSample(idx) {
    setSamples(prev => prev.filter((_, i) => i !== idx));
  }

  function resetForm() {
    setSamples([]);
    setCurrentBlob(null);
    setCurrentUrl(null);
    setRecordSec(0);
    setName('');
    setUploadFile(null);
    if (fileRef.current) fileRef.current.value = '';
    stopRecording();
  }

  /* ── Enroll ─────────────────────────────────────────────────────────────── */
  async function enroll(e) {
    e.preventDefault();
    if (!name.trim()) { toast('Name is required', 'warn'); return; }

    if (mode === 'record') {
      if (samples.length < MIN_ENROLL_SAMPLES) {
        toast(`Record at least ${MIN_ENROLL_SAMPLES} voice samples for reliable identification`, 'warn');
        return;
      }
      setEnrolling(true);
      try {
        for (let i = 0; i < samples.length; i++) {
          const { blob } = samples[i];
          const fd = new FormData();
          fd.append('audio', new File([blob], `sample-${i + 1}.webm`, { type: blob.type }));
          fd.append('name', name.trim());
          await api.form('/speaker/enroll', fd);
        }
        toast(`"${name.trim()}" enrolled with ${samples.length} voice samples`, 'success');
        resetForm();
        fetchSpeakers();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        setEnrolling(false);
      }
    } else {
      // Upload mode — single file
      if (!uploadFile) { toast('Select an audio file', 'warn'); return; }
      setEnrolling(true);
      try {
        const fd = new FormData();
        fd.append('audio', uploadFile);
        fd.append('name', name.trim());
        await api.form('/speaker/enroll', fd);
        toast(`"${name.trim()}" enrolled`, 'success');
        resetForm();
        fetchSpeakers();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        setEnrolling(false);
      }
    }
  }

  async function deleteSpeaker(spkName) {
    if (!confirm(`Remove speaker "${spkName}"?`)) return;
    setDeleting(spkName);
    try {
      await api.delete(`/speaker/${encodeURIComponent(spkName)}`);
      setSpeakers(s => s.filter(x => x !== spkName));
      setSampleCounts(c => { const n = {...c}; delete n[spkName]; return n; });
      toast('Speaker removed', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDeleting(null);
    }
  }

  const canEnroll = mode === 'record'
    ? (samples.length >= MIN_ENROLL_SAMPLES && name.trim())
    : (!!uploadFile && name.trim());

  if (loading) return <div className="empty">Loading…</div>;

  return (
    <>
      <div className="page-hdr">
        <div>
          <h1>Speaker Profiles</h1>
          <p>Enroll voice samples for automatic speaker identification during meetings. 3 samples minimum — 5 is ideal.</p>
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
                <ModeBtn active={mode === 'record'} onClick={() => { setMode('record'); resetForm(); }}>
                  🎙 Record Now
                </ModeBtn>
                <ModeBtn active={mode === 'upload'} onClick={() => { setMode('upload'); resetForm(); }}>
                  📁 Upload File
                </ModeBtn>
              </div>
            </div>

            {/* ── Record mode ─────────────────────────────────────────────── */}
            {mode === 'record' && (
              <>
                {/* Sample progress bar */}
                <SampleProgress completed={samples.length} total={MAX_SAMPLES} min={MIN_ENROLL_SAMPLES} />

                {/* Collected samples */}
                {samples.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                    {samples.map((s, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: 'var(--c-surface2)', borderRadius: 8, padding: '8px 12px',
                      }}>
                        <span style={{ color: 'var(--c-success)', fontSize: 16, flexShrink: 0 }}>✓</span>
                        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
                          Sample {i + 1} <span className="muted">({fmtSec(s.sec)})</span>
                        </span>
                        <audio controls src={s.url} style={{ height: 28, flex: 1, maxWidth: 160 }} />
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeSample(i)}>✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Current recording / phrase */}
                {samples.length < MAX_SAMPLES && (
                  <>
                    {currentStep < ENROLLMENT_PHRASES.length && (
                      <PhraseCard phrase={ENROLLMENT_PHRASES[currentStep]} speakerName={name} />
                    )}

                    {!currentBlob ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                        <button type="button"
                          className={`mic-btn ${recording ? 'active' : 'idle'}`}
                          onClick={() => recording ? stopRecording() : startRecording()}>
                          {recording ? '⏹' : '🎙'}
                        </button>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>
                            {recording
                              ? `Recording sample ${samples.length + 1}… ${fmtSec(recordSec)}`
                              : `Record sample ${samples.length + 1} of ${MIN_ENROLL_SAMPLES}`}
                          </div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {recording ? 'Read the phrase above, then click stop' : 'Click microphone to begin'}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{
                        background: 'var(--c-surface2)', borderRadius: 8, padding: 14, marginBottom: 14,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>
                            Preview — sample {samples.length + 1} ({fmtSec(recordSec)})
                          </span>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={discardCurrent}>✕ Discard</button>
                        </div>
                        {currentUrl && <audio controls src={currentUrl} style={{ width: '100%', height: 34, borderRadius: 6 }} />}
                        <button type="button" className="btn btn-success btn-w" style={{ marginTop: 10 }} onClick={acceptSample}>
                          ✓ Accept Sample {samples.length + 1}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── Upload mode ─────────────────────────────────────────────── */}
            {mode === 'upload' && (
              <div className="form-group">
                <label className="form-label">Audio File <span className="req">*</span></label>
                <div className="file-drop"
                  onClick={() => fileRef.current?.click()}
                  onDrop={e => { e.preventDefault(); setUploadFile(e.dataTransfer.files[0]); }}
                  onDragOver={e => e.preventDefault()}>
                  <div className="file-drop-icon">🎵</div>
                  <div className="file-drop-text">{uploadFile ? uploadFile.name : 'Click or drag a WAV / MP3 file'}</div>
                  <div className="file-drop-hint">10–30 seconds of clean speech recommended</div>
                  {uploadFile && <div className="file-drop-name">{(uploadFile.size / 1024).toFixed(0)} KB</div>}
                </div>
                <input ref={fileRef} type="file" accept="audio/*" style={{ display: 'none' }}
                  onChange={e => setUploadFile(e.target.files[0] || null)} />
              </div>
            )}

            <div className="form-actions">
              <button className="btn btn-primary" disabled={enrolling || !canEnroll}>
                {enrolling ? 'Enrolling…' : `+ Enroll Speaker${mode === 'record' && samples.length > 0 ? ` (${samples.length} samples)` : ''}`}
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
            speakers.map(spkName => {
              const count = sampleCounts[spkName] || 0;
              const col = spkColour(spkName);
              return (
                <div key={spkName} className="spk-item">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="spk-avatar" style={{ background: col }}>
                      {spkName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{spkName}</div>
                      <div style={{ fontSize: 11, color: count >= MIN_ENROLL_SAMPLES ? 'var(--c-success)' : 'var(--c-warn)' }}>
                        {count}/{MAX_SAMPLES} samples
                        {count < MIN_ENROLL_SAMPLES && ' — add more for better accuracy'}
                      </div>
                    </div>
                  </div>
                  <button className="btn btn-danger btn-sm"
                    disabled={deleting === spkName} onClick={() => deleteSpeaker(spkName)}>
                    {deleting === spkName ? '…' : 'Remove'}
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

/* ── Sample progress indicator ───────────────────────────────────────────── */
function SampleProgress({ completed, total, min }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-text)' }}>
          Voice samples collected
        </span>
        <span style={{ fontSize: 12, color: completed >= min ? 'var(--c-success)' : 'var(--c-muted)' }}>
          {completed}/{total} {completed >= min ? '✓ ready to enroll' : `(min ${min})`}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 6, borderRadius: 3,
            background: i < completed
              ? (i < min ? 'var(--c-primary)' : 'var(--c-success)')
              : 'var(--c-surface2)',
            transition: 'background .2s',
          }} />
        ))}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 5 }}>
        Each sample uses a different phrase for broader voice coverage.
      </div>
    </div>
  );
}

/* ── Phrase card ─────────────────────────────────────────────────────────── */
function PhraseCard({ phrase, speakerName }) {
  return (
    <div style={{
      background: 'rgba(31,111,235,.08)', border: '1px solid rgba(31,111,235,.25)',
      borderRadius: 10, padding: '14px 16px', marginBottom: 14,
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--c-accent)', marginBottom: 10 }}>
        📖 {phrase.label} — read clearly and naturally
      </div>
      <div style={{ fontSize: 15, lineHeight: 2.2, color: 'var(--c-text)', direction: 'rtl', textAlign: 'right', fontFamily: 'serif', marginBottom: 6 }}>
        {phrase.ur.replace('_____', speakerName || '_____')}
      </div>
      <div style={{ fontSize: 13, color: 'var(--c-muted)', lineHeight: 1.6 }}>
        {phrase.en.replace('_____', speakerName || '_____')}
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

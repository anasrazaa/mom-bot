import React, { useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppContext, ToastContext } from '../App.jsx';
import { api, wsUrl } from '../api.js';

/* Speaker colour palette — cycles through 10 colours */
const SPK_COLOURS = [
  '#388bfd','#3fb950','#d29922','#f78166','#a5d6ff',
  '#7ee787','#ffa657','#ff7b72','#d2a8ff','#79c0ff',
];

function spkColour(label) {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return SPK_COLOURS[h % SPK_COLOURS.length];
}

export default function ActiveMeeting({ meetingId }) {
  const { navigate, setActiveMeetingId } = useContext(AppContext);
  const toast = useContext(ToastContext);

  /* ── State ──────────────────────────────────────────────────────────────── */
  const [meeting, setMeeting]       = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [micActive, setMicActive]   = useState(false);
  const [elapsed, setElapsed]       = useState(0);
  const [speakers, setSpeakers]     = useState([]);
  const [loading, setLoading]       = useState(true);

  /* ── Refs ───────────────────────────────────────────────────────────────── */
  const audioCtxRef   = useRef(null);
  const workletRef    = useRef(null);
  const analyserRef   = useRef(null);
  const sourceRef     = useRef(null);
  const streamRef     = useRef(null);
  const audioWsRef    = useRef(null);
  const txWsRef       = useRef(null);
  const canvasRef     = useRef(null);
  const animRef       = useRef(null);
  const txEndRef      = useRef(null);
  const timerRef      = useRef(null);
  const startTimeRef  = useRef(null);

  /* ── Load meeting ───────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!meetingId) { navigate('dashboard'); return; }
    Promise.all([
      api.get(`/meetings/${meetingId}`),
      api.get(`/transcript/${meetingId}`).catch(() => []),
      api.get('/speakers').catch(() => []),
    ]).then(([m, tx, spk]) => {
      setMeeting(m);
      setTranscript(Array.isArray(tx) ? tx : []);
      setSpeakers(Array.isArray(spk) ? spk : []);
      setLoading(false);
      if (m.status === 'recording') openTranscriptWs(m.id);
    }).catch(() => { toast('Failed to load meeting', 'error'); navigate('dashboard'); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  /* ── Auto-scroll transcript ─────────────────────────────────────────────── */
  useEffect(() => {
    txEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  /* ── Cleanup on unmount ─────────────────────────────────────────────────── */
  useEffect(() => () => {
    stopAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Transcript WebSocket ───────────────────────────────────────────────── */
  function openTranscriptWs(id) {
    if (txWsRef.current) return;
    const ws = new WebSocket(wsUrl(`/transcript/ws/${id}`));
    txWsRef.current = ws;
    ws.onmessage = e => {
      try {
        const entry = JSON.parse(e.data);
        setTranscript(t => [...t, entry]);
      } catch { /* ignore */ }
    };
    ws.onerror = () => toast('Transcript stream disconnected', 'warn');
    ws.onclose = () => { txWsRef.current = null; };
  }

  /* ── Waveform animation ─────────────────────────────────────────────────── */
  function startWaveform() {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    const buf = new Uint8Array(analyser.frequencyBinCount);

    function draw() {
      animRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(buf);
      const W = canvas.width, H = canvas.height;
      ctx.fillStyle = '#21262d';
      ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#388bfd';
      ctx.shadowBlur = 6;
      ctx.shadowColor = '#1f6feb';
      ctx.beginPath();
      const step = W / buf.length;
      for (let i = 0; i < buf.length; i++) {
        const y = (buf[i] / 255) * H;
        i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * step, y);
      }
      ctx.stroke();
    }
    draw();
  }

  function stopWaveform() {
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#21262d';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  /* ── Mic on/off ─────────────────────────────────────────────────────────── */
  const startMic = useCallback(async () => {
    if (!meetingId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 }, video: false });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = ctx;
      await ctx.audioWorklet.addModule('/audio-processor.js');

      const source   = ctx.createMediaStreamSource(stream);
      const worklet  = new AudioWorkletNode(ctx, 'audio-processor');
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;
      source.connect(analyser);
      source.connect(worklet);
      sourceRef.current  = source;
      workletRef.current = worklet;

      const ws = new WebSocket(wsUrl(`/meeting/ws/audio/${meetingId}`));
      audioWsRef.current = ws;
      ws.binaryType = 'arraybuffer';

      worklet.port.onmessage = ev => {
        if (ws.readyState === WebSocket.OPEN) ws.send(ev.data);
      };

      ws.onopen  = () => { startWaveform(); };
      ws.onerror = () => toast('Audio stream error', 'error');
      ws.onclose = () => { stopMic(); };

      openTranscriptWs(meetingId);

      startTimeRef.current = Date.now() - elapsed * 1000;
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      setMicActive(true);
      toast('Microphone active — recording', 'success');
    } catch (err) {
      toast(`Mic error: ${err.message}`, 'error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, elapsed]);

  function stopMic() {
    clearInterval(timerRef.current);
    cancelAnimationFrame(animRef.current);
    workletRef.current?.disconnect();
    sourceRef.current?.disconnect();
    analyserRef.current = null;
    audioCtxRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (audioWsRef.current?.readyState === WebSocket.OPEN) audioWsRef.current.close();
    audioWsRef.current  = null;
    workletRef.current  = null;
    sourceRef.current   = null;
    audioCtxRef.current = null;
    streamRef.current   = null;
    stopWaveform();
    setMicActive(false);
  }

  function stopAll() {
    stopMic();
    if (txWsRef.current) { txWsRef.current.close(); txWsRef.current = null; }
  }

  /* ── Stop meeting ───────────────────────────────────────────────────────── */
  async function stopMeeting() {
    stopAll();
    try {
      await api.post(`/meetings/${meetingId}/stop`);
      setActiveMeetingId(null);
      toast('Meeting stopped — processing transcript', 'info');
      navigate('meeting-detail', meetingId);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* ── Speaker chip colours ────────────────────────────────────────────────── */
  const spkMap = {};
  speakers.forEach(s => { spkMap[s.label] = s.name || s.label; });

  function fmtTime(s) {
    const m = Math.floor(s / 60), sec = s % 60;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  if (loading) return <div className="empty">Loading meeting…</div>;
  if (!meeting) return null;

  return (
    <>
      <div className="page-hdr">
        <div>
          <div className="rec-badge">
            <div className="status-dot warn" style={{ width: 8, height: 8 }} />
            {micActive ? 'RECORDING' : 'LIVE'}
          </div>
          <h1>{meeting.title}</h1>
          <p>{meeting.location || 'No location'} &nbsp;·&nbsp; {fmtTime(elapsed)}</p>
        </div>
        <div className="page-hdr-actions">
          <button className="btn btn-danger btn-lg" onClick={stopMeeting}>■ Stop Meeting</button>
        </div>
      </div>

      <div className="meeting-layout">
        {/* Left: transcript + waveform */}
        <div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-hdr">
              Live Transcript
              <span className="badge">{transcript.length}</span>
            </div>

            <div className="tx-box">
              {transcript.length === 0 ? (
                <div className="tx-waiting">
                  <div className="pulse-ring" />
                  <span>Waiting for speech…</span>
                </div>
              ) : (
                transcript.map((entry, i) => {
                  const colour = spkColour(entry.speaker || 'Unknown');
                  return (
                    <div key={i} className="tx-entry" style={{ borderLeftColor: colour, background: colour + '14' }}>
                      <div className="tx-speaker" style={{ color: colour }}>
                        {spkMap[entry.speaker] || entry.speaker || 'Unknown'}
                      </div>
                      <div className="tx-text">{entry.text}</div>
                      <div className="tx-ts">{entry.timestamp ? new Date(entry.timestamp * 1000).toISOString().substr(11,8) : ''}</div>
                    </div>
                  );
                })
              )}
              <div ref={txEndRef} />
            </div>

            {/* Waveform */}
            <div className="waveform-wrap">
              <canvas
                ref={canvasRef}
                className="waveform-canvas"
                width={900}
                height={60}
              />
            </div>

            {/* Mic control */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px' }}>
              <button
                className={`mic-btn ${micActive ? 'active' : 'idle'}`}
                onClick={() => micActive ? stopMic() : startMic()}
                title={micActive ? 'Mute microphone' : 'Start microphone'}
              >
                {micActive ? '🔴' : '🎙'}
              </button>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{micActive ? 'Microphone active' : 'Microphone off'}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {micActive ? 'Click to mute' : 'Click to start capturing audio'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: info + speakers */}
        <div className="aside-panels">
          <div className="card">
            <div className="card-hdr">Meeting Info</div>
            <div className="info-list">
              <InfoRow k="Status"   v={<span className="chip chip-recording">{meeting.status}</span>} />
              <InfoRow k="Duration" v={fmtTime(elapsed)} />
              <InfoRow k="ID"       v={<span className="mono">{String(meeting.id).slice(0,8)}…</span>} />
              {meeting.location && <InfoRow k="Location" v={meeting.location} />}
            </div>
          </div>

          <div className="card" style={{ marginTop: 0 }}>
            <div className="card-hdr">Detected Speakers</div>
            <div className="spk-chips">
              {[...new Set(transcript.map(t => t.speaker).filter(Boolean))].map(spk => (
                <span key={spk} className="chip" style={{ background: spkColour(spk) + '22', color: spkColour(spk), border: `1px solid ${spkColour(spk)}55` }}>
                  {spkMap[spk] || spk}
                </span>
              ))}
              {transcript.length === 0 && <span className="muted" style={{ fontSize: 12 }}>None yet</span>}
            </div>
          </div>

          <div className="card" style={{ marginTop: 0 }}>
            <div className="card-hdr">Actions</div>
            <div className="quick-stack">
              <button className="btn btn-outline btn-w" onClick={() => navigate('meeting-detail', meetingId)}>
                📄 View Detail
              </button>
              <button className="btn btn-danger btn-w" onClick={stopMeeting}>
                ■ Stop &amp; Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function InfoRow({ k, v }) {
  return (
    <div className="info-row">
      <span className="info-k">{k}</span>
      <span className="info-v">{v}</span>
    </div>
  );
}

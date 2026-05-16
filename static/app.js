'use strict';

const App = (() => {

  /* ── State ──────────────────────────────────────────────────────────────── */
  const S = {
    view:          'dashboard',
    meeting:       null,   // active meeting object
    detailId:      null,   // meeting ID open in detail view
    txWS:          null,   // live transcript WebSocket
    txEntries:     [],     // live transcript entries
    txSpeakers:    {},     // speaker → colour index
    momGenerated:  false,  // whether MoM was generated for detailId
  };

  const BASE = window.location.origin;
  const API  = `${BASE}`;

  const COLORS = [
    { bg:'#ebf8ff', border:'#3182ce', text:'#2b6cb0', avatar:'#3182ce' },
    { bg:'#f0fff4', border:'#38a169', text:'#276749', avatar:'#38a169' },
    { bg:'#faf5ff', border:'#805ad5', text:'#6b46c1', avatar:'#805ad5' },
    { bg:'#fffbeb', border:'#d69e2e', text:'#b7791f', avatar:'#d69e2e' },
    { bg:'#fff5f5', border:'#e53e3e', text:'#c53030', avatar:'#e53e3e' },
    { bg:'#f0f9ff', border:'#0ea5e9', text:'#0369a1', avatar:'#0ea5e9' },
  ];

  /* ── HTTP helpers ───────────────────────────────────────────────────────── */
  async function get(path) {
    const r = await fetch(API + path);
    if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
    return r.json();
  }

  async function post(path, body) {
    const r = await fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(e.detail || r.statusText);
    }
    return r.json();
  }

  async function postForm(path, formData) {
    const r = await fetch(API + path, { method: 'POST', body: formData });
    if (!r.ok) {
      const e = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(e.detail || r.statusText);
    }
    return r.json();
  }

  async function del(path) {
    const r = await fetch(API + path, { method: 'DELETE' });
    if (!r.ok) throw new Error(`DELETE ${path} → ${r.status}`);
    return r.json();
  }

  /* ── Toast ──────────────────────────────────────────────────────────────── */
  function toast(msg, type = 'info', duration = 4000) {
    const icons = { success:'✓', error:'✗', info:'ℹ', warning:'⚠' };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span>${icons[type]}</span> ${msg}`;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  /* ── Loading overlay ────────────────────────────────────────────────────── */
  function showLoading(txt = 'Processing…') {
    document.getElementById('overlayTxt').textContent = txt;
    document.getElementById('overlay').style.display = 'flex';
  }
  function hideLoading() {
    document.getElementById('overlay').style.display = 'none';
  }

  /* ── Navigation ─────────────────────────────────────────────────────────── */
  function nav(viewName) {
    if (viewName === 'meetings')       { loadMeetings(); }
    if (viewName === 'speakers')       { loadSpeakers(); }
    if (viewName === 'dashboard')      { loadDashboard(); }
    _showView(viewName);
  }

  function navActive() {
    if (S.meeting) _showView('active-meeting');
  }

  function _showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(`view-${name}`);
    if (el) { el.classList.add('active'); S.view = name; }

    document.querySelectorAll('.nav-item').forEach(li => {
      li.classList.toggle('active', li.dataset.view === name);
    });
  }

  /* ── Health polling ─────────────────────────────────────────────────────── */
  async function pollHealth() {
    try {
      const h = await get('/health');
      const dot  = document.getElementById('statusDot');
      const txt  = document.getElementById('statusText');
      if (h.models_loaded) {
        dot.className = 'status-dot ok';
        txt.textContent = 'System Online';
      } else {
        dot.className = 'status-dot warn';
        txt.textContent = 'Initialising…';
      }
      _setModelDot('mVad', h.models_loaded);
      _setModelDot('mStt', h.models_loaded);
      _setModelDot('mDia', h.models_loaded);
      _setModelDot('mLlm', h.ollama_ready);

      document.getElementById('stActive').textContent  = h.active_meetings;
      document.getElementById('stOllama').textContent  = h.ollama_ready ? '✓ Ready' : '✗ Offline';
    } catch {
      document.getElementById('statusDot').className  = 'status-dot error';
      document.getElementById('statusText').textContent = 'Offline';
    }
  }

  function _setModelDot(id, ok) {
    const el = document.getElementById(id);
    if (!el) return;
    const dot = el.querySelector('.dot');
    dot.className = `dot ${ok ? 'dot-green' : 'dot-red'}`;
  }

  /* ── Dashboard ──────────────────────────────────────────────────────────── */
  async function loadDashboard() {
    try {
      const [mtgs, spks] = await Promise.all([
        get('/meeting/history'),
        get('/speaker/'),
      ]);
      document.getElementById('stTotal').textContent    = mtgs.total;
      document.getElementById('stSpeakers').textContent = spks.total;

      const el = document.getElementById('dashRecent');
      const recent = (mtgs.meetings || []).slice(-5).reverse();
      if (!recent.length) {
        el.innerHTML = '<div class="empty">No meetings yet</div>';
        return;
      }
      el.innerHTML = recent.map(m => `
        <div class="mini-meeting">
          <div>
            <div class="mini-meeting-title">${esc(m.title)}</div>
            <div class="mini-meeting-date">${fmtDate(m.start_time)}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            ${statusChip(m.status)}
            <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px"
              onclick="App.openDetail('${m.meeting_id}')">View</button>
          </div>
        </div>`).join('');
    } catch (e) { console.error(e); }
  }

  /* ── Start Meeting ──────────────────────────────────────────────────────── */
  async function startMeeting(ev) {
    ev.preventDefault();
    const title = document.getElementById('fTitle').value.trim();
    const venue = document.getElementById('fVenue').value.trim() || 'GIK Institute';
    const chair = document.getElementById('fChair').value.trim() || null;
    const btn   = document.getElementById('startBtn');
    btn.disabled = true; btn.textContent = 'Starting…';
    try {
      const m = await post('/meeting/start', { title, venue, chaired_by: chair });
      S.meeting = m;
      _activateMeetingUI(m);
      connectTranscriptWS(m.meeting_id);
      _showView('active-meeting');
      toast(`Meeting "${title}" started`, 'success');
      document.getElementById('newMeetingForm').reset();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = '🎙️ Start Recording';
    }
  }

  function _activateMeetingUI(m) {
    document.getElementById('aMeetingTitle').textContent = m.title;
    document.getElementById('aMeetingMeta').textContent =
      `${m.venue || ''} ${m.chaired_by ? '· Chaired by ' + m.chaired_by : ''} · ${fmtDate(m.start_time)}`;
    document.getElementById('iId').textContent    = m.meeting_id.split('-')[0] + '…';
    document.getElementById('iStart').textContent = fmtDate(m.start_time);
    document.getElementById('iVenue').textContent = m.venue || '—';
    document.getElementById('iChair').textContent = m.chaired_by || '—';

    const navEl = document.getElementById('navActive');
    navEl.style.display = 'flex';
    document.getElementById('navActiveTitle').textContent = m.title.slice(0, 18) + (m.title.length > 18 ? '…' : '');

    document.getElementById('txContainer').innerHTML =
      '<div class="tx-waiting"><div class="pulse-ring"></div>Waiting for speech…</div>';
    S.txEntries  = [];
    S.txSpeakers = {};
  }

  /* ── Stop Meeting ───────────────────────────────────────────────────────── */
  async function stopMeeting() {
    if (!S.meeting) return;
    if (!confirm('Stop recording and finalise this meeting?')) return;
    showLoading('Stopping meeting…');
    try {
      if (S.txWS) { S.txWS.close(); S.txWS = null; }
      await post(`/meeting/${S.meeting.meeting_id}/stop`, {});
      toast('Meeting stopped successfully', 'success');
      const id = S.meeting.meeting_id;
      S.meeting = null;
      document.getElementById('navActive').style.display = 'none';
      loadMeetings();
      _showView('meetings');
      // Auto-open detail
      setTimeout(() => openDetail(id), 300);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      hideLoading();
    }
  }

  /* ── Upload Audio ───────────────────────────────────────────────────────── */
  async function uploadAudio(ev) {
    const file = ev.target.files[0];
    if (!file || !S.meeting) return;
    showLoading(`Uploading ${file.name}…`);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await postForm(`/meeting/${S.meeting.meeting_id}/upload_audio`, fd);
      toast(`Audio uploaded — ${r.duration_sec}s queued for processing`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      hideLoading();
      ev.target.value = '';
    }
  }

  /* ── Live Transcript WebSocket ──────────────────────────────────────────── */
  function connectTranscriptWS(meetingId) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws    = new WebSocket(`${proto}://${location.host}/transcript/ws/${meetingId}`);
    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.type === 'transcript') appendTxEntry(msg.data);
    };
    ws.onerror = () => toast('WebSocket error — transcript may not update live', 'warning');
    S.txWS = ws;
  }

  function appendTxEntry(entry) {
    // Remove waiting placeholder
    const box = document.getElementById('txContainer');
    const wait = box.querySelector('.tx-waiting');
    if (wait) wait.remove();

    S.txEntries.push(entry);
    const idx = _speakerIndex(entry.speaker);
    const c   = COLORS[idx % COLORS.length];

    const div = document.createElement('div');
    div.className = 'tx-entry';
    div.style.cssText = `background:${c.bg};border-left-color:${c.border}`;
    div.innerHTML = `
      <div class="tx-speaker" style="color:${c.text}">${esc(entry.speaker)}</div>
      <div class="tx-text">${esc(entry.text)}</div>
      <div class="tx-ts">${fmtSec(entry.start_time)}</div>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;

    document.getElementById('txCount').textContent = S.txEntries.length;
    _updateDetectedSpeakers();
  }

  function _speakerIndex(name) {
    if (!(name in S.txSpeakers)) {
      S.txSpeakers[name] = Object.keys(S.txSpeakers).length;
    }
    return S.txSpeakers[name];
  }

  function _updateDetectedSpeakers() {
    const el = document.getElementById('spkDetected');
    el.innerHTML = Object.entries(S.txSpeakers).map(([name, idx]) => {
      const c = COLORS[idx % COLORS.length];
      return `<span style="background:${c.bg};color:${c.text};border:1px solid ${c.border};
        border-radius:20px;padding:3px 10px;font-size:12px;font-weight:600">${esc(name)}</span>`;
    }).join('');
  }

  /* ── Meeting History ────────────────────────────────────────────────────── */
  async function loadMeetings() {
    const tbody = document.getElementById('meetingsTbody');
    tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Loading…</td></tr>';
    try {
      const { meetings } = await get('/meeting/history');
      if (!meetings.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No meetings recorded yet</td></tr>';
        return;
      }
      tbody.innerHTML = [...meetings].reverse().map(m => `
        <tr>
          <td><strong>${esc(m.title)}</strong></td>
          <td>${fmtDate(m.start_time)}</td>
          <td>${statusChip(m.status)}</td>
          <td>${m.transcript_count}</td>
          <td>
            <div class="tbl-actions">
              <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px"
                onclick="App.openDetail('${m.meeting_id}')">📄 View</button>
            </div>
          </td>
        </tr>`).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Error: ${esc(e.message)}</td></tr>`;
    }
  }

  /* ── Meeting Detail ─────────────────────────────────────────────────────── */
  async function openDetail(id) {
    S.detailId    = id;
    S.momGenerated = false;
    document.getElementById('exportCard').style.display = 'none';
    document.getElementById('genMomBtn').disabled = false;
    document.getElementById('genMomBtn').textContent = '✨ Generate MoM';
    document.getElementById('detTx').innerHTML = '<div class="empty">Loading…</div>';
    _showView('meeting-detail');

    try {
      const [info, tx] = await Promise.all([
        get(`/meeting/${id}`),
        get(`/transcript/${id}`),
      ]);
      document.getElementById('detTitle').textContent = info.title;
      document.getElementById('detMeta').textContent  =
        `${fmtDate(info.start_time)}  ·  ${info.venue || ''}  ·  ${info.transcript_count} entries`;

      if (!tx.entries.length) {
        document.getElementById('detTx').innerHTML = '<div class="empty">No transcript available</div>';
        return;
      }
      const spkMap = {};
      document.getElementById('detTx').innerHTML = tx.entries.map(e => {
        if (!(e.speaker in spkMap)) spkMap[e.speaker] = Object.keys(spkMap).length;
        const c = COLORS[spkMap[e.speaker] % COLORS.length];
        return `<div class="tx-entry" style="background:${c.bg};border-left-color:${c.border}">
          <div class="tx-speaker" style="color:${c.text}">${esc(e.speaker)}</div>
          <div class="tx-text">${esc(e.text)}</div>
          <div class="tx-ts">${fmtSec(e.start_time)}</div>
        </div>`;
      }).join('');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  /* ── Generate MoM ───────────────────────────────────────────────────────── */
  async function generateMoM() {
    if (!S.detailId) return;
    const ctx = document.getElementById('momCtx').value.trim() || null;
    const btn = document.getElementById('genMomBtn');
    btn.disabled = true; btn.textContent = '⏳ Generating…';
    showLoading('Generating Minutes of Meeting…\nThis may take 1–2 minutes.');
    try {
      const { mom } = await post('/meeting/generate_mom', {
        meeting_id: S.detailId,
        additional_context: ctx,
      });
      S.momGenerated = true;
      document.getElementById('exportCard').style.display = 'block';
      btn.textContent = '✓ MoM Generated';
      renderMoMPreview(mom);
      _showView('mom-preview');
      toast('Minutes of Meeting generated successfully!', 'success');
    } catch (e) {
      btn.disabled = false; btn.textContent = '✨ Generate MoM';
      toast(e.message, 'error');
    } finally {
      hideLoading();
    }
  }

  function renderMoMPreview(mom) {
    const el = document.getElementById('momPreview');
    const ai = (mom.action_items || []).map((a, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(a.item)}</td>
        <td>${esc(a.responsible)}</td>
        <td>${esc(a.deadline)}</td>
      </tr>`).join('');

    const decisions = (mom.decisions || []).map(d => `
      <div class="mom-decision">
        ${esc(d.decision)}
        ${d.made_by ? `<span class="muted" style="font-size:12px"> — ${esc(d.made_by)}</span>` : ''}
      </div>`).join('');

    const discussions = (mom.discussion_summary || []).map(d => `
      <div class="mom-discussion-item">
        <div class="mom-discussion-topic">${esc(d.topic)}</div>
        <div class="mom-discussion-body">${esc(d.summary)}</div>
        ${d.speaker ? `<div class="muted" style="font-size:12px;margin-top:3px">Led by: ${esc(d.speaker)}</div>` : ''}
      </div>`).join('');

    el.innerHTML = `
      <h2>MINUTES OF MEETING</h2>
      <div class="inst">Ghulam Ishaq Khan Institute of Engineering Sciences and Technology</div>

      <div class="mom-section">
        <div class="mom-section-title">Meeting Details</div>
        <div class="mom-meta-grid">
          <div class="mom-meta-row"><span class="mom-meta-k">Title</span><span class="mom-meta-v">${esc(mom.meeting_title)}</span></div>
          <div class="mom-meta-row"><span class="mom-meta-k">Date</span><span class="mom-meta-v">${esc(mom.date)}</span></div>
          <div class="mom-meta-row"><span class="mom-meta-k">Time</span><span class="mom-meta-v">${esc(mom.time)}</span></div>
          <div class="mom-meta-row"><span class="mom-meta-k">Venue</span><span class="mom-meta-v">${esc(mom.venue)}</span></div>
          <div class="mom-meta-row"><span class="mom-meta-k">Chair</span><span class="mom-meta-v">${esc(mom.chaired_by)}</span></div>
        </div>
      </div>

      ${mom.attendees?.length ? `
      <div class="mom-section">
        <div class="mom-section-title">Attendees</div>
        ${mom.attendees.map(a => `<div class="mom-list-item">• ${esc(a)}</div>`).join('')}
      </div>` : ''}

      ${mom.agenda_items?.length ? `
      <div class="mom-section">
        <div class="mom-section-title">Agenda</div>
        ${mom.agenda_items.map((a, i) => `<div class="mom-list-item">${i + 1}. ${esc(a)}</div>`).join('')}
      </div>` : ''}

      ${discussions ? `
      <div class="mom-section">
        <div class="mom-section-title">Discussion Summary</div>
        ${discussions}
      </div>` : ''}

      ${decisions ? `
      <div class="mom-section">
        <div class="mom-section-title">Decisions Taken</div>
        ${decisions}
      </div>` : ''}

      ${mom.action_items?.length ? `
      <div class="mom-section">
        <div class="mom-section-title">Action Items</div>
        <table class="mom-action-table">
          <thead><tr><th>#</th><th>Action Item</th><th>Responsible</th><th>Deadline</th></tr></thead>
          <tbody>${ai}</tbody>
        </table>
      </div>` : ''}

      <div class="mom-section">
        <div class="mom-section-title">Next Meeting</div>
        <div class="mom-list-item">${esc(mom.next_meeting || 'To be announced')}</div>
      </div>

      ${mom.closing_remarks ? `
      <div class="mom-section">
        <div class="mom-section-title">Closing Remarks</div>
        <div class="mom-list-item">${esc(mom.closing_remarks)}</div>
      </div>` : ''}

      <div style="text-align:center;color:var(--muted);font-size:12px;margin-top:24px;padding-top:16px;border-top:1px solid var(--border)">
        Document generated on ${esc(fmtDate(mom.generated_at))}
      </div>`;
  }

  /* ── Export ─────────────────────────────────────────────────────────────── */
  function downloadDocx() {
    if (!S.detailId) return;
    window.open(`${BASE}/export/${S.detailId}/docx`, '_blank');
  }
  function downloadPdf() {
    if (!S.detailId) return;
    window.open(`${BASE}/export/${S.detailId}/pdf`, '_blank');
  }

  /* ── Speaker enrollment ─────────────────────────────────────────────────── */
  function onSpkFile(ev) {
    const f = ev.target.files[0];
    document.getElementById('spkFileName').textContent = f ? f.name : '';
  }

  async function enrollSpeaker(ev) {
    ev.preventDefault();
    const name  = document.getElementById('spkName').value.trim();
    const audio = document.getElementById('spkAudio').files[0];
    if (!audio) { toast('Please select a voice sample', 'warning'); return; }
    const btn = document.getElementById('enrollBtn');
    btn.disabled = true; btn.textContent = 'Enrolling…';
    showLoading(`Enrolling ${name}…`);
    const fd = new FormData();
    fd.append('name', name);
    fd.append('audio', audio);
    try {
      const r = await postForm('/speaker/enroll', fd);
      toast(r.message, 'success');
      document.getElementById('enrollForm').reset();
      document.getElementById('spkFileName').textContent = '';
      loadSpeakers();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Enroll Speaker';
      hideLoading();
    }
  }

  async function loadSpeakers() {
    try {
      const { speakers, total } = await get('/speaker/');
      document.getElementById('spkBadge').textContent = total;
      const el = document.getElementById('spkList');
      if (!speakers.length) {
        el.innerHTML = '<div class="empty">No speakers enrolled yet</div>';
        return;
      }
      el.innerHTML = speakers.map((name, i) => {
        const c = COLORS[i % COLORS.length];
        return `<div class="spk-item">
          <div style="display:flex;align-items:center">
            <div class="spk-avatar" style="background:${c.avatar}">${initials(name)}</div>
            <span class="spk-name">${esc(name)}</span>
          </div>
          <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;color:var(--danger)"
            onclick="App.deleteSpeaker('${esc(name)}')">Remove</button>
        </div>`;
      }).join('');
    } catch (e) { console.error(e); }
  }

  async function deleteSpeaker(name) {
    if (!confirm(`Remove speaker "${name}"?`)) return;
    try {
      await del(`/speaker/${encodeURIComponent(name)}`);
      toast(`${name} removed`, 'info');
      loadSpeakers();
    } catch (e) { toast(e.message, 'error'); }
  }

  /* ── Utilities ──────────────────────────────────────────────────────────── */
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-PK', {
      day:'2-digit', month:'short', year:'numeric',
      hour:'2-digit', minute:'2-digit',
    });
  }
  function fmtSec(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  function statusChip(s) {
    const map = { recording:'chip-recording', stopped:'chip-stopped', processing:'chip-processing', completed:'chip-completed' };
    return `<span class="chip ${map[s] || ''}">${s}</span>`;
  }
  function initials(name) {
    return name.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }

  /* ── Init ───────────────────────────────────────────────────────────────── */
  function init() {
    _showView('dashboard');
    loadDashboard();
    pollHealth();
    setInterval(pollHealth, 15000);
    setInterval(() => { if (S.view === 'meetings') loadMeetings(); }, 30000);
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */
  return {
    nav, navActive,
    startMeeting, stopMeeting, uploadAudio,
    loadMeetings, openDetail,
    generateMoM, downloadDocx, downloadPdf,
    enrollSpeaker, loadSpeakers, deleteSpeaker, onSpkFile,
    init,
  };

})();

document.addEventListener('DOMContentLoaded', App.init);

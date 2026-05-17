import React, { useContext, useEffect, useState } from 'react';
import { AppContext, ToastContext } from '../App.jsx';
import { api } from '../api.js';

const SPK_COLOURS = ['#388bfd','#3fb950','#d29922','#f78166','#a5d6ff','#7ee787','#ffa657','#ff7b72','#d2a8ff','#79c0ff'];
function spkColour(label, index) {
  if (index !== undefined) return SPK_COLOURS[index % SPK_COLOURS.length];
  let h = 0;
  for (let i = 0; i < (label||'').length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return SPK_COLOURS[h % SPK_COLOURS.length];
}
function fmtSec(s) {
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

/* ── Horizontal Bar Chart ─────────────────────────────────────────────────── */
function BarChart({ data, valueKey, labelKey, colorKey, maxVal, title, unit }) {
  const W = 340, BAR_H = 28, GAP = 8, LABEL_W = 130, BAR_AREA = W - LABEL_W - 50;
  const height = data.length * (BAR_H + GAP) + 10;
  return (
    <div className="chart-wrap">
      <div className="chart-title">{title}</div>
      <svg width="100%" viewBox={`0 0 ${W} ${height}`} style={{ overflow: 'visible' }}>
        <defs>
          {data.map((d, i) => (
            <linearGradient key={i} id={`bg${i}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={d[colorKey]} stopOpacity="0.9" />
              <stop offset="100%" stopColor={d[colorKey]} stopOpacity="0.4" />
            </linearGradient>
          ))}
        </defs>
        {data.map((d, i) => {
          const y = i * (BAR_H + GAP);
          const barW = maxVal > 0 ? (d[valueKey] / maxVal) * BAR_AREA : 0;
          const pct = d.pct_time !== undefined ? d.pct_time : '';
          return (
            <g key={i}>
              {/* Label */}
              <text x={0} y={y + BAR_H / 2 + 5} fontSize={11} fill="var(--c-text)"
                fontWeight="500" style={{ fontFamily: 'inherit' }}>
                {(d[labelKey] || '').length > 16 ? d[labelKey].slice(0,15)+'…' : d[labelKey]}
              </text>
              {/* Bar background */}
              <rect x={LABEL_W} y={y + 2} width={BAR_AREA} height={BAR_H - 4}
                rx={4} fill="var(--c-border)" opacity={0.5} />
              {/* Bar fill */}
              {barW > 0 && (
                <rect x={LABEL_W} y={y + 2} width={barW} height={BAR_H - 4}
                  rx={4} fill={`url(#bg${i})`}>
                  <animate attributeName="width" from="0" to={barW} dur="0.6s" fill="freeze" />
                </rect>
              )}
              {/* Value */}
              <text x={LABEL_W + barW + 6} y={y + BAR_H / 2 + 5} fontSize={10}
                fill={d[colorKey]} fontWeight="600" style={{ fontFamily: 'inherit' }}>
                {unit === 'time' ? fmtSec(d[valueKey]) : d[valueKey]}
                {pct !== '' && <tspan fill="var(--c-muted)" fontWeight="400"> {pct}%</tspan>}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── Donut Chart ──────────────────────────────────────────────────────────── */
function DonutChart({ data, title }) {
  const R = 70, CX = 90, CY = 90, stroke = 28;
  const circumference = 2 * Math.PI * R;
  let offset = 0;
  const segments = data.map((d, i) => {
    const dash = (d.pct_time / 100) * circumference;
    const gap  = circumference - dash;
    const seg  = { ...d, dash, gap, offset, color: spkColour(d.speaker, i) };
    offset += dash;
    return seg;
  });

  return (
    <div className="chart-wrap">
      <div className="chart-title">{title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <svg width={180} height={180} style={{ flexShrink: 0 }}>
          <defs>
            <filter id="donut-shadow">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.15" />
            </filter>
          </defs>
          {/* Track */}
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--c-border)" strokeWidth={stroke} />
          {/* Segments */}
          {segments.map((seg, i) => (
            <circle key={i} cx={CX} cy={CY} r={R} fill="none"
              stroke={seg.color} strokeWidth={stroke}
              strokeDasharray={`${seg.dash} ${seg.gap}`}
              strokeDashoffset={circumference - seg.offset}
              transform={`rotate(-90 ${CX} ${CY})`}
              style={{ transition: 'stroke-dasharray 0.5s ease' }}
              filter="url(#donut-shadow)"
            />
          ))}
          {/* Centre text */}
          <text x={CX} y={CY - 6} textAnchor="middle" fontSize={11} fill="var(--c-muted)" fontFamily="inherit">speakers</text>
          <text x={CX} y={CY + 12} textAnchor="middle" fontSize={22} fontWeight="700" fill="var(--c-text)" fontFamily="inherit">
            {data.length}
          </text>
        </svg>
        {/* Legend */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {segments.map((seg, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: seg.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--c-text)' }}>
                {seg.speaker.length > 18 ? seg.speaker.slice(0,17)+'…' : seg.speaker}
              </span>
              <span style={{ fontSize: 11, color: 'var(--c-muted)', marginLeft: 'auto' }}>{seg.pct_time}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Cross-meeting stacked bar ────────────────────────────────────────────── */
function CrossMeetingChart({ meetings, allSpeakers }) {
  if (!meetings.length) return null;
  const colourMap = {};
  allSpeakers.forEach((s, i) => { colourMap[s] = spkColour(s, i); });

  const BAR_W = Math.max(40, Math.min(70, 600 / meetings.length));
  const CHART_H = 160, GAP = 12, LABEL_H = 50;
  const totalW = meetings.length * (BAR_W + GAP) + 20;
  const maxDur = Math.max(...meetings.map(m => m.total_duration_sec), 1);

  return (
    <div className="chart-wrap">
      <div className="chart-title">Speaking Time Across Meetings</div>
      <div style={{ overflowX: 'auto' }}>
        <svg width={totalW} height={CHART_H + LABEL_H} style={{ minWidth: 200, overflow: 'visible' }}>
          {meetings.map((m, mi) => {
            const x = 10 + mi * (BAR_W + GAP);
            let yBase = CHART_H;
            const bars = m.speakers.map(spk => {
              const h = (spk.speaking_time_sec / maxDur) * CHART_H;
              yBase -= h;
              return { spk, h, y: yBase, color: colourMap[spk.speaker] || '#888' };
            });
            return (
              <g key={mi}>
                {bars.map((b, bi) => (
                  <rect key={bi} x={x} y={b.y} width={BAR_W} height={b.h}
                    fill={b.color} rx={bi === 0 ? 4 : 0}
                    style={{ opacity: 0.85 }}>
                    <title>{b.spk.speaker}: {fmtSec(b.spk.speaking_time_sec)}</title>
                  </rect>
                ))}
                {/* Meeting label */}
                <text x={x + BAR_W / 2} y={CHART_H + 14} textAnchor="middle"
                  fontSize={9} fill="var(--c-muted)" fontFamily="inherit">
                  {m.date}
                </text>
                <text x={x + BAR_W / 2} y={CHART_H + 26} textAnchor="middle"
                  fontSize={9} fill="var(--c-text)" fontFamily="inherit">
                  {m.title.length > 12 ? m.title.slice(0, 11) + '…' : m.title}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {/* Colour legend */}
      <div className="cross-legend">
        {allSpeakers.map((s, i) => (
          <div key={i} className="cross-legend-item">
            <div style={{ width: 10, height: 10, borderRadius: 2, background: colourMap[s], flexShrink: 0 }} />
            <span>{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Stats row ────────────────────────────────────────────────────────────── */
function StatCard({ label, value, sub }) {
  return (
    <div className="analytics-stat-card">
      <div className="analytics-stat-val">{value}</div>
      <div className="analytics-stat-lbl">{label}</div>
      {sub && <div className="analytics-stat-sub">{sub}</div>}
    </div>
  );
}

/* ── Main Analytics page ──────────────────────────────────────────────────── */
export default function Analytics() {
  const { navigate } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [cross, setCross]             = useState(null);
  const [selected, setSelected]       = useState(null);
  const [perMeeting, setPerMeeting]   = useState(null);
  const [loadingCross, setLoadingCross] = useState(true);
  const [loadingPer, setLoadingPer]   = useState(false);

  useEffect(() => {
    api.get('/analytics/cross-meeting')
      .then(d => { setCross(d); if (d.meetings.length) setSelected(d.meetings[d.meetings.length - 1].meeting_id); })
      .catch(() => toast('Failed to load analytics', 'error'))
      .finally(() => setLoadingCross(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoadingPer(true);
    api.get(`/analytics/meeting/${selected}`)
      .then(setPerMeeting)
      .catch(() => setPerMeeting(null))
      .finally(() => setLoadingPer(false));
  }, [selected]);

  if (loadingCross) return <div className="empty">Loading analytics…</div>;

  const topSpeaker = cross?.meetings.length
    ? (() => {
        const agg = {};
        cross.meetings.forEach(m => m.speakers.forEach(s => {
          agg[s.speaker] = (agg[s.speaker] || 0) + s.speaking_time_sec;
        }));
        return Object.entries(agg).sort((a,b) => b[1]-a[1])[0] || null;
      })()
    : null;

  const totalMeetingsSec = cross?.meetings.reduce((s,m) => s + m.total_duration_sec, 0) || 0;

  return (
    <>
      <div className="page-hdr">
        <div>
          <h1>Analytics</h1>
          <p>Speaker participation across {cross?.meetings.length || 0} meetings</p>
        </div>
      </div>

      {(!cross || !cross.meetings.length) ? (
        <div className="card">
          <div className="empty" style={{ padding: 40 }}>
            No meeting data yet. Complete a meeting with transcripts to see analytics.
          </div>
        </div>
      ) : (
        <>
          {/* ── Summary stats ─────────────────────────────────────── */}
          <div className="analytics-stats-row">
            <StatCard label="Total Meetings" value={cross.meetings.length} />
            <StatCard label="Total Meeting Time" value={fmtSec(totalMeetingsSec)} />
            <StatCard label="Unique Speakers" value={cross.all_speakers.length} />
            {topSpeaker && (
              <StatCard label="Most Active Speaker" value={topSpeaker[0].split(' ')[0]} sub={fmtSec(topSpeaker[1])} />
            )}
          </div>

          {/* ── Cross-meeting chart ───────────────────────────────── */}
          {cross.meetings.length > 1 && (
            <div className="card analytics-card">
              <CrossMeetingChart meetings={cross.meetings} allSpeakers={cross.all_speakers} />
            </div>
          )}

          {/* ── Per-meeting deep dive ─────────────────────────────── */}
          <div className="card analytics-card">
            <div className="card-hdr">
              Per-Meeting Breakdown
              <select
                className="analytics-select"
                value={selected || ''}
                onChange={e => setSelected(e.target.value)}
              >
                {[...cross.meetings].reverse().map(m => (
                  <option key={m.meeting_id} value={m.meeting_id}>
                    {m.date} — {m.title.length > 40 ? m.title.slice(0,39)+'…' : m.title}
                  </option>
                ))}
              </select>
            </div>

            {loadingPer && <div className="empty">Loading…</div>}

            {!loadingPer && perMeeting && (
              <div className="analytics-grid">
                {/* Bar: speaking time */}
                <BarChart
                  data={perMeeting.speakers.map((s, i) => ({ ...s, color: spkColour(s.speaker, i) }))}
                  valueKey="speaking_time_sec"
                  labelKey="speaker"
                  colorKey="color"
                  maxVal={perMeeting.speakers[0]?.speaking_time_sec || 1}
                  title="Speaking Time"
                  unit="time"
                />
                {/* Bar: word count */}
                <BarChart
                  data={perMeeting.speakers.map((s, i) => ({ ...s, color: spkColour(s.speaker, i) }))}
                  valueKey="word_count"
                  labelKey="speaker"
                  colorKey="color"
                  maxVal={perMeeting.speakers[0]?.word_count || 1}
                  title="Word Count"
                  unit="words"
                />
                {/* Donut chart */}
                <DonutChart data={perMeeting.speakers} title="Participation Share" />

                {/* Stats table */}
                <div className="chart-wrap">
                  <div className="chart-title">Speaker Summary</div>
                  <table className="analytics-table">
                    <thead>
                      <tr>
                        <th>Speaker</th>
                        <th>Time</th>
                        <th>Words</th>
                        <th>Turns</th>
                        <th>Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perMeeting.speakers.map((s, i) => (
                        <tr key={i}>
                          <td>
                            <span className="spk-dot" style={{ background: spkColour(s.speaker, i) }} />
                            {s.speaker}
                          </td>
                          <td>{fmtSec(s.speaking_time_sec)}</td>
                          <td>{s.word_count.toLocaleString()}</td>
                          <td>{s.segment_count}</td>
                          <td>
                            <div className="mini-bar">
                              <div className="mini-bar-fill"
                                style={{ width: `${s.pct_time}%`, background: spkColour(s.speaker, i) }} />
                            </div>
                            <span style={{ fontSize: 11, color: 'var(--c-muted)' }}>{s.pct_time}%</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

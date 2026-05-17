import React, { useContext, useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, PieChart as PieIcon, TrendingUp, Users } from 'lucide-react';
import { AppContext, ToastContext } from '../App.jsx';
import { api } from '../api.js';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, PieChart, Pie, Cell, LabelList,
} from 'recharts';

const COLORS = [
  '#388bfd','#3fb950','#f59e0b','#f78166','#a5d6ff',
  '#7ee787','#ffa657','#ff7b72','#d2a8ff','#79c0ff',
];

function spkColor(label, idx) {
  if (idx !== undefined) return COLORS[idx % COLORS.length];
  let h = 0;
  for (let i = 0; i < (label || '').length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function fmtSec(s) {
  if (s == null || isNaN(s)) return '0s';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

/* ─── Equity ring gauge ──────────────────────────────────────────────────── */
function EquityGauge({ score }) {
  const pct  = Math.round((score ?? 1) * 100);
  const circ = 2 * Math.PI * 32;
  const arc  = (pct / 100) * circ;
  const color = pct >= 75 ? '#3fb950' : pct >= 50 ? '#f59e0b' : '#f85149';
  const label = pct >= 75 ? 'Balanced' : pct >= 50 ? 'Moderate' : 'Unbalanced';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={80} height={80} viewBox="0 0 80 80">
        <circle cx={40} cy={40} r={32} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth={8} />
        <circle cx={40} cy={40} r={32} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={`${arc} ${circ}`} transform="rotate(-90 40 40)"
          style={{ transition: 'stroke-dasharray 0.9s ease' }} />
        <text x={40} y={36} textAnchor="middle" fontSize={17} fontWeight="700"
          fill={color} fontFamily="inherit">{pct}%</text>
        <text x={40} y={50} textAnchor="middle" fontSize={8.5} fill="var(--text-2)"
          fontFamily="inherit">equity</text>
      </svg>
      <span style={{ fontSize: 11, color }}>{label}</span>
    </div>
  );
}

/* ─── Recharts shared tooltip ────────────────────────────────────────────── */
function ChartTooltip({ active, payload, label, fmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rchart-tip">
      {label && <div className="rchart-tip-label">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="rchart-tip-row">
          <span className="rchart-tip-dot" style={{ background: p.color ?? p.fill }} />
          <span className="rchart-tip-name">{p.name}:</span>
          <span className="rchart-tip-val" style={{ color: p.color ?? p.fill }}>
            {fmt ? fmt(p.value, p.name) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── KPI stat card ──────────────────────────────────────────────────────── */
function StatCard({ label, value, sub, extra, icon }) {
  return (
    <motion.div className="analytics-stat-card" whileHover={{ y: -2 }} transition={{ duration: 0.2 }}>
      {extra ? extra : (
        <>
          {icon && <div style={{ marginBottom: 8, opacity: 0.6 }}>{icon}</div>}
          <div className="analytics-stat-val">{value}</div>
        </>
      )}
      <div className="analytics-stat-lbl">{label}</div>
      {sub && <div className="analytics-stat-sub">{sub}</div>}
    </motion.div>
  );
}

/* ─── Meeting Gantt timeline ─────────────────────────────────────────────── */
function MeetingTimeline({ timeline, speakers }) {
  if (!timeline?.length || !speakers?.length) return null;
  const LABEL_W = 110, BAR_H = 22, GAP = 8, BAR_AREA = 560;
  const duration = Math.max(...timeline.map(t => t.end_time), 1);
  const height   = speakers.length * (BAR_H + GAP);
  const colorMap = Object.fromEntries(speakers.map((s, i) => [s, spkColor(s, i)]));
  const ticks    = Array.from({ length: 6 }, (_, i) => Math.round(duration * i / 5));
  return (
    <div className="chart-wrap" style={{ marginTop: 12 }}>
      <div className="chart-title">Speaking Timeline</div>
      <div style={{ overflowX: 'auto' }}>
        <svg width={LABEL_W + BAR_AREA + 10} height={height + 28}
          style={{ minWidth: 360, overflow: 'visible', display: 'block' }}>
          {ticks.map((t, i) => {
            const x = LABEL_W + (t / duration) * BAR_AREA;
            return (
              <g key={i}>
                <line x1={x} y1={0} x2={x} y2={height} stroke="rgba(255,255,255,.07)" strokeWidth={0.6} strokeDasharray="4 3" />
                <text x={x} y={height + 16} textAnchor="middle" fontSize={9} fill="var(--text-3)" fontFamily="inherit">{fmtSec(t)}</text>
              </g>
            );
          })}
          {speakers.map((spk, si) => {
            const y     = si * (BAR_H + GAP);
            const color = colorMap[spk] || '#888';
            const segs  = timeline.filter(t => t.speaker === spk);
            return (
              <g key={si}>
                <text x={0} y={y + BAR_H / 2 + 4} fontSize={10} fill="var(--text)" fontWeight="500" fontFamily="inherit">
                  {spk.length > 14 ? spk.slice(0, 13) + '…' : spk}
                </text>
                <rect x={LABEL_W} y={y + 2} width={BAR_AREA} height={BAR_H - 4} rx={3} fill="rgba(255,255,255,.04)" />
                {segs.map((seg, i) => {
                  const sx = LABEL_W + (seg.start_time / duration) * BAR_AREA;
                  const sw = Math.max(2, ((seg.end_time - seg.start_time) / duration) * BAR_AREA);
                  return (
                    <rect key={i} x={sx} y={y + 2} width={sw} height={BAR_H - 4} rx={2} fill={color} opacity={0.82}>
                      <title>{spk}: {fmtSec(seg.start_time)} → {fmtSec(seg.end_time)}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ─── Main Analytics page ────────────────────────────────────────────────── */
export default function Analytics() {
  const { navigate } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [cross,        setCross]        = useState(null);
  const [selected,     setSelected]     = useState(null);
  const [perMeeting,   setPerMeeting]   = useState(null);
  const [loadingCross, setLoadingCross] = useState(true);
  const [loadingPer,   setLoadingPer]   = useState(false);
  const [pieActive,    setPieActive]    = useState(null);

  useEffect(() => {
    api.get('/analytics/cross-meeting')
      .then(d => {
        setCross(d);
        if (d.meetings.length) setSelected(d.meetings[d.meetings.length - 1].meeting_id);
      })
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

  const topSpeaker = useMemo(() => {
    if (!cross?.meetings.length) return null;
    const agg = {};
    cross.meetings.forEach(m => m.speakers.forEach(s => { agg[s.speaker] = (agg[s.speaker] || 0) + s.speaking_time_sec; }));
    return Object.entries(agg).sort((a, b) => b[1] - a[1])[0] || null;
  }, [cross]);

  const totalSec  = cross?.meetings.reduce((s, m) => s + m.total_duration_sec, 0) || 0;
  const avgEquity = cross?.meetings.length
    ? cross.meetings.reduce((s, m) => s + (m.equity_score ?? 1), 0) / cross.meetings.length
    : null;

  const crossChartData = useMemo(() => {
    if (!cross?.meetings.length) return [];
    const top8 = cross.all_speakers.slice(0, 8);
    return cross.meetings.map(m => {
      const pt = { name: m.date.slice(-6), title: m.title };
      top8.forEach(spk => {
        const s = m.speakers.find(x => x.speaker === spk);
        pt[spk] = s ? Math.round(s.speaking_time_sec) : 0;
      });
      return pt;
    });
  }, [cross]);

  const radarData = useMemo(() => {
    if (!perMeeting?.speakers.length) return [];
    const spks    = perMeeting.speakers.slice(0, 5);
    const maxTime = Math.max(...spks.map(s => s.speaking_time_sec), 1);
    const maxWds  = Math.max(...spks.map(s => s.word_count), 1);
    const maxSegs = Math.max(...spks.map(s => s.segment_count), 1);
    const maxWPM  = Math.max(...spks.map(s => s.speaking_rate_wpm || 0), 1);
    const maxTurn = Math.max(...spks.map(s => s.avg_turn_duration || 0), 1);
    return [
      { metric: 'Time',     ...Object.fromEntries(spks.map(s => [s.speaker, Math.round(s.speaking_time_sec / maxTime * 100)])) },
      { metric: 'Words',    ...Object.fromEntries(spks.map(s => [s.speaker, Math.round(s.word_count / maxWds * 100)])) },
      { metric: 'Turns',    ...Object.fromEntries(spks.map(s => [s.speaker, Math.round(s.segment_count / maxSegs * 100)])) },
      { metric: 'WPM',      ...Object.fromEntries(spks.map(s => [s.speaker, Math.round((s.speaking_rate_wpm || 0) / maxWPM * 100)])) },
      { metric: 'Avg Turn', ...Object.fromEntries(spks.map(s => [s.speaker, Math.round((s.avg_turn_duration || 0) / maxTurn * 100)])) },
    ];
  }, [perMeeting]);

  if (loadingCross) return (
    <div className="loading-page"><div className="spinner" /><span>Loading analytics…</span></div>
  );

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Analytics</div>
          <div className="page-sub">Meeting intelligence across {cross?.meetings.length || 0} sessions</div>
        </div>
      </div>

      {(!cross || !cross.meetings.length) ? (
        <div className="glass-card">
          <div className="empty-state" style={{ padding: '60px 0' }}>
            <div className="empty-state-icon"><BarChart3 size={28} /></div>
            <div className="empty-state-title">No meeting data yet</div>
            <div className="empty-state-desc">Complete a meeting with transcripts to see analytics.</div>
          </div>
        </div>
      ) : (
        <>
          {/* ── KPI Row ────────────────────────────────────────────── */}
          <div className="analytics-stats-row">
            <StatCard label="Total Meetings"  value={cross.meetings.length}         icon={<BarChart3 size={18} />} />
            <StatCard label="Total Time"      value={fmtSec(totalSec)}              icon={<TrendingUp size={18} />} />
            <StatCard label="Unique Speakers" value={cross.all_speakers.length}     icon={<Users size={18} />} />
            {topSpeaker && (
              <StatCard label="Most Active" value={topSpeaker[0].split(' ')[0]} sub={fmtSec(topSpeaker[1])} />
            )}
            {avgEquity !== null && (
              <StatCard label="Avg Balance" extra={<EquityGauge score={avgEquity} />} />
            )}
          </div>

          {/* ── Cross-meeting stacked bar ─────────────────────────── */}
          {cross.meetings.length > 1 && (
            <motion.div className="glass-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <div className="card-header">
                <div className="card-header-left">
                  <div className="card-header-icon"><BarChart3 size={13} /></div>
                  Speaking Time Across Meetings
                </div>
              </div>
              <div className="card-body">
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={crossChartData} margin={{ top: 8, right: 16, bottom: 28, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: 'var(--text-3)', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmtSec} tick={{ fill: 'var(--text-3)', fontSize: 9 }} axisLine={false} tickLine={false} width={50} />
                    <Tooltip content={<ChartTooltip fmt={v => fmtSec(v)} />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    {cross.all_speakers.slice(0, 8).map((spk, i) => (
                      <Bar key={spk} dataKey={spk} stackId="a" fill={spkColor(spk, i)}
                        radius={i === Math.min(7, cross.all_speakers.length - 1) ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          )}

          {/* ── Per-meeting deep dive ─────────────────────────────── */}
          <motion.div className="glass-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.08 }}>
            <div className="card-header">
              <div className="card-header-left">
                <div className="card-header-icon"><PieIcon size={13} /></div>
                Per-Meeting Deep Dive
              </div>
              <select style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}
                value={selected || ''} onChange={e => setSelected(e.target.value)}>
                {[...cross.meetings].reverse().map(m => (
                  <option key={m.meeting_id} value={m.meeting_id}>
                    {m.date} — {m.title.length > 40 ? m.title.slice(0, 39) + '…' : m.title}
                  </option>
                ))}
              </select>
            </div>

            {loadingPer && <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-2)' }}>Loading…</div>}

            {!loadingPer && perMeeting && (() => {
              const spks = perMeeting.speakers;
              return (
                <div className="card-body">
                  {/* Per-meeting KPI strip */}
                  <div className="analytics-stats-row" style={{ marginBottom: 20 }}>
                    <StatCard label="Duration"    value={fmtSec(perMeeting.total_duration_sec)} />
                    <StatCard label="Speakers"    value={spks.length} />
                    <StatCard label="Total Words" value={perMeeting.total_words.toLocaleString()} />
                    <StatCard label="Silence"     value={`${perMeeting.silence_pct ?? 0}%`} sub="of meeting" />
                    <StatCard label="Balance"     extra={<EquityGauge score={perMeeting.equity_score ?? 1} />} />
                  </div>

                  <div className="analytics-grid">
                    {/* 1 ── Horizontal bar: Speaking Time */}
                    <div className="chart-wrap">
                      <div className="chart-title">Speaking Time</div>
                      <ResponsiveContainer width="100%" height={Math.max(160, spks.length * 46)}>
                        <BarChart layout="vertical"
                          data={spks.map((s, i) => ({ name: s.speaker, value: s.speaking_time_sec, fill: spkColor(s.speaker, i) }))}
                          margin={{ top: 0, right: 64, bottom: 0, left: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" horizontal={false} />
                          <XAxis type="number" tickFormatter={fmtSec} tick={{ fill: 'var(--text-3)', fontSize: 9 }} axisLine={false} tickLine={false} />
                          <YAxis dataKey="name" type="category" width={96} tick={{ fill: 'var(--text)', fontSize: 10 }} axisLine={false} tickLine={false} />
                          <Tooltip content={<ChartTooltip fmt={v => fmtSec(v)} />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                          <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive>
                            {spks.map((s, i) => <Cell key={i} fill={spkColor(s.speaker, i)} />)}
                            <LabelList dataKey="value" position="right" formatter={fmtSec} style={{ fill: 'var(--text-3)', fontSize: 9 }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* 2 ── Radar: Speaker comparison */}
                    {spks.length >= 2 && radarData.length > 0 && (
                      <div className="chart-wrap">
                        <div className="chart-title">Speaker Comparison</div>
                        <ResponsiveContainer width="100%" height={240}>
                          <RadarChart data={radarData} margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
                            <PolarGrid stroke="rgba(255,255,255,.07)" />
                            <PolarAngleAxis dataKey="metric" tick={{ fill: 'var(--text-3)', fontSize: 10 }} />
                            <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: 'var(--text-3)', fontSize: 7 }} />
                            {spks.slice(0, 5).map((s, i) => (
                              <Radar key={s.speaker} name={s.speaker} dataKey={s.speaker}
                                stroke={spkColor(s.speaker, i)} fill={spkColor(s.speaker, i)}
                                fillOpacity={0.12} strokeWidth={2} />
                            ))}
                            <Legend wrapperStyle={{ fontSize: 10 }} />
                            <Tooltip content={<ChartTooltip fmt={v => `${v}%`} />} />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* 3 ── Pie: Participation share */}
                    <div className="chart-wrap">
                      <div className="chart-title">Participation Share</div>
                      <div className="pie-row">
                        <ResponsiveContainer width={190} height={190}>
                          <PieChart>
                            <Pie
                              data={spks.map((s, i) => ({ name: s.speaker, value: s.pct_time, fill: spkColor(s.speaker, i) }))}
                              cx="50%" cy="50%" innerRadius={48} outerRadius={82}
                              dataKey="value" paddingAngle={2}
                              onMouseEnter={(_, i) => setPieActive(i)}
                              onMouseLeave={() => setPieActive(null)}>
                              {spks.map((s, i) => (
                                <Cell key={i} fill={spkColor(s.speaker, i)}
                                  opacity={pieActive === null || pieActive === i ? 1 : 0.45}
                                  stroke={pieActive === i ? '#fff' : 'transparent'} strokeWidth={2} />
                              ))}
                            </Pie>
                            <Tooltip formatter={v => [`${v}%`]}
                              contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="pie-legend">
                          {spks.map((s, i) => (
                            <div key={i} className="pie-legend-row">
                              <span className="pie-dot" style={{ background: spkColor(s.speaker, i) }} />
                              <span className="pie-name">{s.speaker.length > 16 ? s.speaker.slice(0, 15) + '…' : s.speaker}</span>
                              <span className="pie-pct">{s.pct_time}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 4 ── Table: full stats */}
                    <div className="chart-wrap">
                      <div className="chart-title">Speaker Summary</div>
                      <table className="data-table">
                        <thead>
                          <tr><th>Speaker</th><th>Time</th><th>Words</th><th>WPM</th><th>Turns</th><th>Avg Turn</th><th>Share</th></tr>
                        </thead>
                        <tbody>
                          {spks.map((s, i) => (
                            <tr key={i}>
                              <td><span className="spk-dot" style={{ background: spkColor(s.speaker, i), display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 6 }} />{s.speaker}</td>
                              <td>{fmtSec(s.speaking_time_sec)}</td>
                              <td>{s.word_count.toLocaleString()}</td>
                              <td>{s.speaking_rate_wpm ?? 0}</td>
                              <td>{s.segment_count}</td>
                              <td>{s.avg_turn_duration ? fmtSec(s.avg_turn_duration) : '—'}</td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.07)' }}>
                                    <div style={{ width: `${s.pct_time}%`, height: '100%', borderRadius: 2, background: spkColor(s.speaker, i) }} />
                                  </div>
                                  <span style={{ fontSize: 11, color: 'var(--text-2)', flexShrink: 0 }}>{s.pct_time}%</span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* ── Timeline (full width) ───────────────────────── */}
                  {perMeeting.timeline?.length > 0 && (
                    <MeetingTimeline timeline={perMeeting.timeline} speakers={spks.map(s => s.speaker)} />
                  )}
                </div>
              );
            })()}
          </motion.div>
        </>
      )}
    </>
  );
}

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, PieChart, Pie, Cell, LabelList,
} from 'recharts';

const COLORS = [
  '#388bfd','#3fb950','#f59e0b','#f78166','#a5d6ff',
  '#7ee787','#ffa657','#ff7b72','#d2a8ff','#79c0ff',
];

function spkColor(label, idx) {
  if (idx !== undefined) return COLORS[idx % COLORS.length];
  let h = 0;
  for (let i = 0; i < (label || '').length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function fmtSec(s) {
  if (s == null || isNaN(s)) return '0s';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

/* ─── Equity ring gauge ──────────────────────────────────────────────────── */
function EquityGauge({ score }) {
  const pct  = Math.round((score ?? 1) * 100);
  const circ = 2 * Math.PI * 32;
  const arc  = (pct / 100) * circ;
  const color = pct >= 75 ? '#3fb950' : pct >= 50 ? '#f59e0b' : '#f85149';
  const label = pct >= 75 ? 'Balanced' : pct >= 50 ? 'Moderate' : 'Unbalanced';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={80} height={80} viewBox="0 0 80 80">
        <circle cx={40} cy={40} r={32} fill="none" stroke="var(--c-border)" strokeWidth={8} />
        <circle
          cx={40} cy={40} r={32} fill="none"
          stroke={color} strokeWidth={8}
          strokeDasharray={`${arc} ${circ}`}
          transform="rotate(-90 40 40)"
          style={{ transition: 'stroke-dasharray 0.9s ease' }}
        />
        <text x={40} y={36} textAnchor="middle" fontSize={17} fontWeight="700"
          fill={color} fontFamily="inherit">{pct}%</text>
        <text x={40} y={50} textAnchor="middle" fontSize={8.5} fill="var(--c-muted)"
          fontFamily="inherit">equity</text>
      </svg>
      <span style={{ fontSize: 11, color }}>{label}</span>
    </div>
  );
}

/* ─── Recharts shared tooltip ────────────────────────────────────────────── */
function ChartTooltip({ active, payload, label, fmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rchart-tip">
      {label && <div className="rchart-tip-label">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="rchart-tip-row">
          <span className="rchart-tip-dot" style={{ background: p.color ?? p.fill }} />
          <span className="rchart-tip-name">{p.name}:</span>
          <span className="rchart-tip-val" style={{ color: p.color ?? p.fill }}>
            {fmt ? fmt(p.value, p.name) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── KPI stat card ──────────────────────────────────────────────────────── */
function StatCard({ label, value, sub, extra }) {
  return (
    <div className="analytics-stat-card">
      {extra || <div className="analytics-stat-val">{value}</div>}
      <div className="analytics-stat-lbl">{label}</div>
      {sub && <div className="analytics-stat-sub">{sub}</div>}
    </div>
  );
}

/* ─── Meeting Gantt timeline ─────────────────────────────────────────────── */
function MeetingTimeline({ timeline, speakers }) {
  if (!timeline?.length || !speakers?.length) return null;

  const LABEL_W = 110, BAR_H = 22, GAP = 8, BAR_AREA = 560;
  const duration = Math.max(...timeline.map(t => t.end_time), 1);
  const height   = speakers.length * (BAR_H + GAP);
  const colorMap = Object.fromEntries(speakers.map((s, i) => [s, spkColor(s, i)]));

  const ticks = Array.from({ length: 6 }, (_, i) => Math.round(duration * i / 5));

  return (
    <div className="chart-wrap" style={{ marginTop: 12 }}>
      <div className="chart-title">Speaking Timeline</div>
      <div style={{ overflowX: 'auto' }}>
        <svg
          width={LABEL_W + BAR_AREA + 10}
          height={height + 28}
          style={{ minWidth: 360, overflow: 'visible', display: 'block' }}
        >
          {ticks.map((t, i) => {
            const x = LABEL_W + (t / duration) * BAR_AREA;
            return (
              <g key={i}>
                <line x1={x} y1={0} x2={x} y2={height}
                  stroke="var(--c-border)" strokeWidth={0.6} strokeDasharray="4 3" />
                <text x={x} y={height + 16} textAnchor="middle" fontSize={9}
                  fill="var(--c-muted)" fontFamily="inherit">{fmtSec(t)}</text>
              </g>
            );
          })}

          {speakers.map((spk, si) => {
            const y     = si * (BAR_H + GAP);
            const color = colorMap[spk] || '#888';
            const segs  = timeline.filter(t => t.speaker === spk);
            return (
              <g key={si}>
                <text x={0} y={y + BAR_H / 2 + 4} fontSize={10} fill="var(--c-text)"
                  fontWeight="500" fontFamily="inherit">
                  {spk.length > 14 ? spk.slice(0, 13) + '…' : spk}
                </text>
                <rect x={LABEL_W} y={y + 2} width={BAR_AREA} height={BAR_H - 4}
                  rx={3} fill="var(--c-border)" opacity={0.25} />
                {segs.map((seg, i) => {
                  const sx = LABEL_W + (seg.start_time / duration) * BAR_AREA;
                  const sw = Math.max(2, ((seg.end_time - seg.start_time) / duration) * BAR_AREA);
                  return (
                    <rect key={i} x={sx} y={y + 2} width={sw} height={BAR_H - 4}
                      rx={2} fill={color} opacity={0.82}>
                      <title>{spk}: {fmtSec(seg.start_time)} → {fmtSec(seg.end_time)}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ─── Main Analytics page ────────────────────────────────────────────────── */
export default function Analytics() {
  const { navigate } = useContext(AppContext);
  const toast = useContext(ToastContext);

  const [cross,        setCross]        = useState(null);
  const [selected,     setSelected]     = useState(null);
  const [perMeeting,   setPerMeeting]   = useState(null);
  const [loadingCross, setLoadingCross] = useState(true);
  const [loadingPer,   setLoadingPer]   = useState(false);
  const [pieActive,    setPieActive]    = useState(null);

  useEffect(() => {
    api.get('/analytics/cross-meeting')
      .then(d => {
        setCross(d);
        if (d.meetings.length)
          setSelected(d.meetings[d.meetings.length - 1].meeting_id);
      })
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

  const topSpeaker = useMemo(() => {
    if (!cross?.meetings.length) return null;
    const agg = {};
    cross.meetings.forEach(m =>
      m.speakers.forEach(s => { agg[s.speaker] = (agg[s.speaker] || 0) + s.speaking_time_sec; })
    );
    return Object.entries(agg).sort((a, b) => b[1] - a[1])[0] || null;
  }, [cross]);

  const totalSec  = cross?.meetings.reduce((s, m) => s + m.total_duration_sec, 0) || 0;
  const avgEquity = cross?.meetings.length
    ? cross.meetings.reduce((s, m) => s + (m.equity_score ?? 1), 0) / cross.meetings.length
    : null;

  const crossChartData = useMemo(() => {
    if (!cross?.meetings.length) return [];
    const top8 = cross.all_speakers.slice(0, 8);
    return cross.meetings.map(m => {
      const pt = { name: m.date.slice(-6), title: m.title };
      top8.forEach(spk => {
        const s = m.speakers.find(x => x.speaker === spk);
        pt[spk] = s ? Math.round(s.speaking_time_sec) : 0;
      });
      return pt;
    });
  }, [cross]);

  const radarData = useMemo(() => {
    if (!perMeeting?.speakers.length) return [];
    const spks    = perMeeting.speakers.slice(0, 5);
    const maxTime = Math.max(...spks.map(s => s.speaking_time_sec), 1);
    const maxWds  = Math.max(...spks.map(s => s.word_count), 1);
    const maxSegs = Math.max(...spks.map(s => s.segment_count), 1);
    const maxWPM  = Math.max(...spks.map(s => s.speaking_rate_wpm || 0), 1);
    const maxTurn = Math.max(...spks.map(s => s.avg_turn_duration || 0), 1);
    return [
      { metric: 'Time',     ...Object.fromEntries(spks.map(s => [s.speaker, Math.round(s.speaking_time_sec / maxTime * 100)])) },
      { metric: 'Words',    ...Object.fromEntries(spks.map(s => [s.speaker, Math.round(s.word_count / maxWds * 100)])) },
      { metric: 'Turns',    ...Object.fromEntries(spks.map(s => [s.speaker, Math.round(s.segment_count / maxSegs * 100)])) },
      { metric: 'WPM',      ...Object.fromEntries(spks.map(s => [s.speaker, Math.round((s.speaking_rate_wpm || 0) / maxWPM * 100)])) },
      { metric: 'Avg Turn', ...Object.fromEntries(spks.map(s => [s.speaker, Math.round((s.avg_turn_duration || 0) / maxTurn * 100)])) },
    ];
  }, [perMeeting]);

  if (loadingCross) return <div className="empty">Loading analytics…</div>;

  return (
    <>
      <div className="page-hdr">
        <div>
          <h1>Analytics</h1>
          <p>Meeting intelligence across {cross?.meetings.length || 0} sessions</p>
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
          {/* ── KPI Row ─────────────────────────────────────────────── */}
          <div className="analytics-stats-row">
            <StatCard label="Total Meetings"  value={cross.meetings.length} />
            <StatCard label="Total Time"      value={fmtSec(totalSec)} />
            <StatCard label="Unique Speakers" value={cross.all_speakers.length} />
            {topSpeaker && (
              <StatCard label="Most Active" value={topSpeaker[0].split(' ')[0]} sub={fmtSec(topSpeaker[1])} />
            )}
            {avgEquity !== null && (
              <StatCard label="Avg Balance" extra={<EquityGauge score={avgEquity} />} />
            )}
          </div>

          {/* ── Cross-meeting stacked bar ────────────────────────────── */}
          {cross.meetings.length > 1 && (
            <div className="card analytics-card">
              <div className="card-hdr">Speaking Time Across Meetings</div>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={crossChartData} margin={{ top: 8, right: 16, bottom: 28, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--c-border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: 'var(--c-muted)', fontSize: 10 }}
                    axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtSec} tick={{ fill: 'var(--c-muted)', fontSize: 9 }}
                    axisLine={false} tickLine={false} width={50} />
                  <Tooltip content={<ChartTooltip fmt={v => fmtSec(v)} />}
                    cursor={{ fill: 'var(--c-border)', opacity: 0.3 }} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  {cross.all_speakers.slice(0, 8).map((spk, i) => (
                    <Bar key={spk} dataKey={spk} stackId="a" fill={spkColor(spk, i)}
                      radius={i === Math.min(7, cross.all_speakers.length - 1) ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Per-meeting deep dive ────────────────────────────────── */}
          <div className="card analytics-card">
            <div className="card-hdr">
              Per-Meeting Deep Dive
              <select className="analytics-select" value={selected || ''}
                onChange={e => setSelected(e.target.value)}>
                {[...cross.meetings].reverse().map(m => (
                  <option key={m.meeting_id} value={m.meeting_id}>
                    {m.date} — {m.title.length > 40 ? m.title.slice(0, 39) + '…' : m.title}
                  </option>
                ))}
              </select>
            </div>

            {loadingPer && <div className="empty" style={{ padding: 32 }}>Loading…</div>}

            {!loadingPer && perMeeting && (() => {
              const spks = perMeeting.speakers;
              return (
                <>
                  {/* Per-meeting KPI strip */}
                  <div className="analytics-stats-row" style={{ padding: '0 18px 4px' }}>
                    <StatCard label="Duration"    value={fmtSec(perMeeting.total_duration_sec)} />
                    <StatCard label="Speakers"    value={spks.length} />
                    <StatCard label="Total Words" value={perMeeting.total_words.toLocaleString()} />
                    <StatCard label="Silence"     value={`${perMeeting.silence_pct ?? 0}%`} sub="of meeting" />
                    <StatCard label="Balance" extra={<EquityGauge score={perMeeting.equity_score ?? 1} />} />
                  </div>

                  <div className="analytics-grid">

                    {/* 1 ── Horizontal bar: Speaking Time */}
                    <div className="chart-wrap">
                      <div className="chart-title">Speaking Time</div>
                      <ResponsiveContainer width="100%" height={Math.max(160, spks.length * 46)}>
                        <BarChart
                          layout="vertical"
                          data={spks.map((s, i) => ({
                            name: s.speaker, value: s.speaking_time_sec,
                            fill: spkColor(s.speaker, i),
                          }))}
                          margin={{ top: 0, right: 64, bottom: 0, left: 8 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--c-border)" horizontal={false} />
                          <XAxis type="number" tickFormatter={fmtSec}
                            tick={{ fill: 'var(--c-muted)', fontSize: 9 }} axisLine={false} tickLine={false} />
                          <YAxis dataKey="name" type="category" width={96}
                            tick={{ fill: 'var(--c-text)', fontSize: 10 }} axisLine={false} tickLine={false} />
                          <Tooltip content={<ChartTooltip fmt={v => fmtSec(v)} />}
                            cursor={{ fill: 'var(--c-border)', opacity: 0.2 }} />
                          <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive>
                            {spks.map((s, i) => <Cell key={i} fill={spkColor(s.speaker, i)} />)}
                            <LabelList dataKey="value" position="right" formatter={fmtSec}
                              style={{ fill: 'var(--c-muted)', fontSize: 9 }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* 2 ── Radar: Speaker comparison */}
                    {spks.length >= 2 && radarData.length > 0 && (
                      <div className="chart-wrap">
                        <div className="chart-title">Speaker Comparison</div>
                        <ResponsiveContainer width="100%" height={240}>
                          <RadarChart data={radarData} margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
                            <PolarGrid stroke="var(--c-border)" />
                            <PolarAngleAxis dataKey="metric"
                              tick={{ fill: 'var(--c-muted)', fontSize: 10 }} />
                            <PolarRadiusAxis angle={90} domain={[0, 100]}
                              tick={{ fill: 'var(--c-muted)', fontSize: 7 }} />
                            {spks.slice(0, 5).map((s, i) => (
                              <Radar key={s.speaker} name={s.speaker} dataKey={s.speaker}
                                stroke={spkColor(s.speaker, i)} fill={spkColor(s.speaker, i)}
                                fillOpacity={0.12} strokeWidth={2} />
                            ))}
                            <Legend wrapperStyle={{ fontSize: 10 }} />
                            <Tooltip content={<ChartTooltip fmt={v => `${v}%`} />} />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {/* 3 ── Pie: Participation share */}
                    <div className="chart-wrap">
                      <div className="chart-title">Participation Share</div>
                      <div className="pie-row">
                        <ResponsiveContainer width={190} height={190}>
                          <PieChart>
                            <Pie
                              data={spks.map((s, i) => ({
                                name: s.speaker, value: s.pct_time,
                                fill: spkColor(s.speaker, i),
                              }))}
                              cx="50%" cy="50%"
                              innerRadius={48} outerRadius={82}
                              dataKey="value" paddingAngle={2}
                              onMouseEnter={(_, i) => setPieActive(i)}
                              onMouseLeave={() => setPieActive(null)}
                            >
                              {spks.map((s, i) => (
                                <Cell key={i} fill={spkColor(s.speaker, i)}
                                  opacity={pieActive === null || pieActive === i ? 1 : 0.45}
                                  stroke={pieActive === i ? '#fff' : 'transparent'}
                                  strokeWidth={2} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={v => [`${v}%`]}
                              contentStyle={{
                                background: 'var(--c-surface)', border: '1px solid var(--c-border)',
                                borderRadius: 8, fontSize: 12,
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="pie-legend">
                          {spks.map((s, i) => (
                            <div key={i} className="pie-legend-row">
                              <span className="pie-dot" style={{ background: spkColor(s.speaker, i) }} />
                              <span className="pie-name">
                                {s.speaker.length > 16 ? s.speaker.slice(0, 15) + '…' : s.speaker}
                              </span>
                              <span className="pie-pct">{s.pct_time}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 4 ── Table: full stats */}
                    <div className="chart-wrap">
                      <div className="chart-title">Speaker Summary</div>
                      <table className="analytics-table">
                        <thead>
                          <tr>
                            <th>Speaker</th><th>Time</th><th>Words</th>
                            <th>WPM</th><th>Turns</th><th>Avg Turn</th><th>Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {spks.map((s, i) => (
                            <tr key={i}>
                              <td>
                                <span className="spk-dot" style={{ background: spkColor(s.speaker, i) }} />
                                {s.speaker}
                              </td>
                              <td>{fmtSec(s.speaking_time_sec)}</td>
                              <td>{s.word_count.toLocaleString()}</td>
                              <td>{s.speaking_rate_wpm ?? 0}</td>
                              <td>{s.segment_count}</td>
                              <td>{s.avg_turn_duration ? fmtSec(s.avg_turn_duration) : '—'}</td>
                              <td>
                                <div className="mini-bar">
                                  <div className="mini-bar-fill"
                                    style={{ width: `${s.pct_time}%`, background: spkColor(s.speaker, i) }} />
                                </div>
                                <span style={{ fontSize: 11, color: 'var(--c-muted)' }}>{s.pct_time}%</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                  </div>

                  {/* ── Timeline (full width) ─────────────────────────── */}
                  {perMeeting.timeline?.length > 0 && (
                    <div style={{ padding: '0 18px 18px' }}>
                      <MeetingTimeline
                        timeline={perMeeting.timeline}
                        speakers={spks.map(s => s.speaker)}
                      />
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </>
      )}
    </>
  );
}

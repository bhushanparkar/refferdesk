// ReferDesk frontend. Talks to the same-origin API (proxied to :3000 in dev).

import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API || "";
const STAGES = ["requested", "shortlisted", "referred", "interview", "offer", "joined"];
const EMPLOYEE_STATUSES = ["shortlisted", "referred", "interview", "offer", "joined", "rejected"];

async function api(path, { method = "GET", body } = {}) {
  const token = localStorage.getItem("token");
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) {
      localStorage.removeItem("token");
      window.location.reload();
    }
    throw new Error(data.error || "Something went wrong");
  }
  return data;
}

/* ---------- Small shared pieces ---------- */

function Notice({ kind = "error", children }) {
  if (!children) return null;
  return (
    <p className={`notice ${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

// The memorable element: referral progress as a real sequence of stages
function Stepper({ status }) {
  if (status === "rejected" || status === "withdrawn")
    return <p className="stopped">Closed: {status}</p>;
  const idx = STAGES.indexOf(status);
  return (
    <ol className="steps" aria-label={`Referral stage: ${status}`}>
      {STAGES.map((s, i) => (
        <li key={s} className={i <= idx ? "done" : ""} aria-current={i === idx ? "step" : undefined}>
          {s}
        </li>
      ))}
    </ol>
  );
}

function MatchBar({ score }) {
  const pct = Math.round(Number(score) || 0);
  return (
    <div className="match">
      <div className="track">
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
      <span>{pct}% skill match</span>
    </div>
  );
}

function SkillPicker({ skills, value, onChange }) {
  const toggle = (id) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="chips">
      {skills.map((s) => (
        <button
          type="button"
          key={s.id}
          className={`chip ${value.includes(s.id) ? "on" : ""}`}
          aria-pressed={value.includes(s.id)}
          onClick={() => toggle(s.id)}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}

/* ---------- Sign in ---------- */

function SignIn({ onDone }) {
  const [step, setStep] = useState("email");
  const [role, setRole] = useState("candidate");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendCode(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api("/auth/request-otp", { method: "POST", body: { email, role } });
      setStep("otp");
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  async function verify(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const data = await api("/auth/verify-otp", {
        method: "POST",
        body: { email, otp, name, role, consent },
      });
      localStorage.setItem("token", data.token);
      onDone(data.user);
    } catch (ex) {
      setErr(ex.message);
    }
    setBusy(false);
  }

  return (
    <main className="wrap narrow">
      <h1 className="brand big">ReferDesk</h1>
      <p className="lede">
        Employees at IT companies share open roles. Job seekers ask for a referral. Nobody pays
        for a referral.
      </p>

      {step === "email" ? (
        <form onSubmit={sendCode}>
          <fieldset className="seg">
            <legend>I am</legend>
            <label className={role === "candidate" ? "on" : ""}>
              <input type="radio" checked={role === "candidate"} onChange={() => setRole("candidate")} />
              Looking for a job
            </label>
            <label className={role === "employee" ? "on" : ""}>
              <input type="radio" checked={role === "employee"} onChange={() => setRole("employee")} />
              Working at an IT company
            </label>
          </fieldset>

          <label className="field">
            {role === "employee" ? "Company email" : "Email"}
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={role === "employee" ? "name@yourcompany.com" : "you@example.com"}
            />
          </label>
          {role === "employee" && (
            <p className="hint">We check your company domain to confirm you work there.</p>
          )}
          <Notice>{err}</Notice>
          <button className="btn" disabled={busy}>
            {busy ? "Sending code" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <p className="hint">We sent a 6-digit code to {email}.</p>
          <label className="field">
            Code
            <input
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
            />
          </label>
          <label className="field">
            Your name (new accounts only)
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            I agree that ReferDesk stores my details to match me with referrals.
          </label>
          <Notice>{err}</Notice>
          <button className="btn" disabled={busy}>
            {busy ? "Signing in" : "Sign in"}
          </button>
          <button type="button" className="btn ghost" onClick={() => setStep("email")}>
            Use a different email
          </button>
        </form>
      )}
    </main>
  );
}

/* ---------- Candidate screens ---------- */

function Jobs() {
  const [jobs, setJobs] = useState([]);
  const [skills, setSkills] = useState([]);
  const [mine, setMine] = useState(new Set());
  const [skillId, setSkillId] = useState("");
  const [loc, setLoc] = useState("");
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState({ kind: "error", text: "" });

  async function load() {
    const q = new URLSearchParams();
    if (skillId) q.set("skill_id", skillId);
    if (loc) q.set("location", loc);
    const [j, r] = await Promise.all([api(`/jobs?${q}`), api("/my/requests")]);
    setJobs(j);
    setMine(new Set(r.map((x) => x.job_post_id)));
  }

  useEffect(() => {
    api("/skills").then(setSkills).catch(() => {});
  }, []);
  useEffect(() => {
    load().catch((e) => setMsg({ kind: "error", text: e.message }));
  }, [skillId, loc]);

  async function request(id) {
    try {
      await api(`/jobs/${id}/request`, { method: "POST", body: { note } });
      setOpen(null);
      setNote("");
      setMsg({ kind: "ok", text: "Referral requested. Track it under My requests." });
      load();
    } catch (e) {
      setMsg({ kind: "error", text: e.message });
    }
  }

  return (
    <section>
      <div className="filters">
        <label className="field">
          Skill
          <select value={skillId} onChange={(e) => setSkillId(e.target.value)}>
            <option value="">Any skill</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Location
          <input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Pune, Bengaluru" />
        </label>
      </div>
      <Notice kind={msg.kind}>{msg.text}</Notice>

      {jobs.length === 0 && <p className="empty">No open roles match. Clear a filter to see more.</p>}
      {jobs.map((j) => (
        <article className="row" key={j.id}>
          <h3>{j.title}</h3>
          <p className="meta">
            {j.company}, {j.location || "Location open"}, {j.experience_min}
            {j.experience_max ? `-${j.experience_max}` : "+"} yrs
          </p>
          <p className="skills">{(j.skills || []).join(", ")}</p>
          <a href={j.public_link} target="_blank" rel="noreferrer" className="link">
            View the original posting
          </a>
          {mine.has(j.id) ? (
            <p className="done-tag">You have requested this referral</p>
          ) : open === j.id ? (
            <div className="inline-form">
              <label className="field">
                Note to the employee
                <textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Your relevant experience in a sentence or two"
                />
              </label>
              <button className="btn" onClick={() => request(j.id)}>Send request</button>
              <button className="btn ghost" onClick={() => setOpen(null)}>Cancel</button>
            </div>
          ) : (
            <button className="btn" onClick={() => setOpen(j.id)}>Request referral</button>
          )}
        </article>
      ))}
    </section>
  );
}

function MyRequests() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api("/my/requests").then(setRows).catch(() => setRows([]));
  }, []);
  if (!rows) return <p className="empty">Loading</p>;
  if (rows.length === 0) return <p className="empty">No requests yet. Find a role under Jobs.</p>;
  return (
    <section>
      {rows.map((r) => (
        <article className="row" key={r.id}>
          <h3>{r.title}</h3>
          <p className="meta">{r.company}</p>
          <MatchBar score={r.match_score} />
          <Stepper status={r.status} />
        </article>
      ))}
    </section>
  );
}

function Profile() {
  const [skills, setSkills] = useState([]);
  const [p, setP] = useState(null);
  const [msg, setMsg] = useState({ kind: "ok", text: "" });

  useEffect(() => {
    Promise.all([api("/skills"), api("/my/profile")]).then(([s, pr]) => {
      setSkills(s);
      setP({
        experience_years: pr.experience_years ?? "",
        notice_period_days: pr.notice_period_days ?? "",
        current_location: pr.current_location ?? "",
        expected_ctc_lpa: pr.expected_ctc_lpa ?? "",
        resume_url: pr.resume_url ?? "",
        skill_ids: pr.skill_ids || [],
      });
    });
  }, []);

  if (!p) return <p className="empty">Loading</p>;
  const set = (k) => (e) => setP({ ...p, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    try {
      await api("/my/profile", { method: "PUT", body: p });
      setMsg({ kind: "ok", text: "Profile saved" });
    } catch (ex) {
      setMsg({ kind: "error", text: ex.message });
    }
  }

  return (
    <form onSubmit={save}>
      <p className="hint">Employees see this when you request a referral. Your skills drive the match score.</p>
      <div className="grid2">
        <label className="field">Experience (years)
          <input type="number" step="0.5" min="0" value={p.experience_years} onChange={set("experience_years")} />
        </label>
        <label className="field">Notice period (days)
          <input type="number" min="0" value={p.notice_period_days} onChange={set("notice_period_days")} />
        </label>
        <label className="field">Current location
          <input value={p.current_location} onChange={set("current_location")} />
        </label>
        <label className="field">Expected CTC (lakh per year)
          <input type="number" step="0.5" min="0" value={p.expected_ctc_lpa} onChange={set("expected_ctc_lpa")} />
        </label>
      </div>
      <label className="field">Resume link
        <input type="url" value={p.resume_url} onChange={set("resume_url")} placeholder="https://drive.google.com/..." />
      </label>
      <p className="label">Skills</p>
      <SkillPicker skills={skills} value={p.skill_ids} onChange={(v) => setP({ ...p, skill_ids: v })} />
      <Notice kind={msg.kind}>{msg.text}</Notice>
      <button className="btn">Save profile</button>
    </form>
  );
}

/* ---------- Employee screens ---------- */

function PostJob({ onPosted }) {
  const [skills, setSkills] = useState([]);
  const [f, setF] = useState({
    title: "", external_job_id: "", public_link: "", location: "",
    experience_min: 0, experience_max: "", skill_ids: [],
  });
  const [msg, setMsg] = useState({ kind: "error", text: "" });
  useEffect(() => {
    api("/skills").then(setSkills).catch(() => {});
  }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    try {
      await api("/jobs", {
        method: "POST",
        body: { ...f, experience_min: Number(f.experience_min) || 0, experience_max: f.experience_max ? Number(f.experience_max) : null },
      });
      onPosted();
    } catch (ex) {
      setMsg({ kind: "error", text: ex.message });
    }
  }

  return (
    <form onSubmit={submit}>
      <p className="hint">Post only roles that are publicly listed by your company.</p>
      <label className="field">Job title
        <input required value={f.title} onChange={set("title")} />
      </label>
      <label className="field">Public job link
        <input required type="url" value={f.public_link} onChange={set("public_link")} placeholder="https://careers.company.com/..." />
      </label>
      <div className="grid2">
        <label className="field">Job ID
          <input value={f.external_job_id} onChange={set("external_job_id")} />
        </label>
        <label className="field">Location
          <input value={f.location} onChange={set("location")} />
        </label>
        <label className="field">Minimum years
          <input type="number" min="0" value={f.experience_min} onChange={set("experience_min")} />
        </label>
        <label className="field">Maximum years
          <input type="number" min="0" value={f.experience_max} onChange={set("experience_max")} />
        </label>
      </div>
      <p className="label">Skills needed</p>
      <SkillPicker skills={skills} value={f.skill_ids} onChange={(v) => setF({ ...f, skill_ids: v })} />
      <Notice kind={msg.kind}>{msg.text}</Notice>
      <button className="btn">Post role</button>
    </form>
  );
}

function Candidates({ job, onBack }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const load = () => api(`/jobs/${job.id}/candidates`).then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [job.id]);

  async function setStatus(id, status) {
    try {
      await api(`/requests/${id}/status`, { method: "PATCH", body: { status } });
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <section>
      <button className="btn ghost" onClick={onBack}>Back to my roles</button>
      <h2>{job.title}</h2>
      <Notice>{err}</Notice>
      {rows && rows.length === 0 && <p className="empty">No requests yet. Share the role with people who fit.</p>}
      {(rows || []).map((c) => (
        <article className="row" key={c.request_id}>
          <h3>{c.name}</h3>
          <p className="meta">
            {c.experience_years} yrs, notice {c.notice_period_days ?? "not set"} days, {c.current_location || "location not set"}
          </p>
          <MatchBar score={c.match_score} />
          {c.note && <p className="note">{c.note}</p>}
          {c.resume_url && (
            <a className="link" href={c.resume_url} target="_blank" rel="noreferrer">Open resume</a>
          )}
          <Stepper status={c.status} />
          <label className="field">
            Move to stage
            <select value={c.status} onChange={(e) => setStatus(c.request_id, e.target.value)}>
              {c.status === "requested" && <option value="requested">requested</option>}
              {EMPLOYEE_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </article>
      ))}
    </section>
  );
}

function MyJobs() {
  const [jobs, setJobs] = useState(null);
  const [sel, setSel] = useState(null);
  useEffect(() => {
    api("/my/jobs").then(setJobs).catch(() => setJobs([]));
  }, []);
  if (sel) return <Candidates job={sel} onBack={() => setSel(null)} />;
  if (!jobs) return <p className="empty">Loading</p>;
  if (jobs.length === 0) return <p className="empty">You have not posted a role yet. Use Post a role.</p>;
  return (
    <section>
      {jobs.map((j) => (
        <article className="row clickable" key={j.id}>
          <h3>{j.title}</h3>
          <p className="meta">{j.location || "Location open"}, {j.request_count} request{j.request_count === 1 ? "" : "s"}</p>
          <button className="btn ghost" onClick={() => setSel(j)}>Review candidates</button>
        </article>
      ))}
    </section>
  );
}

/* ---------- Shell ---------- */

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState(null);

  useEffect(() => {
    if (!localStorage.getItem("token")) return setReady(true);
    api("/auth/me").then(setUser).catch(() => {}).finally(() => setReady(true));
  }, []);

  const tabs = user?.role === "employee"
    ? [["jobs", "My roles"], ["post", "Post a role"]]
    : [["find", "Jobs"], ["requests", "My requests"], ["profile", "Profile"]];
  const current = tab || tabs[0]?.[0];

  if (!ready) return null;

  return (
    <>
      <style>{CSS}</style>
      {!user ? (
        <SignIn onDone={(u) => { setUser(u); setTab(null); }} />
      ) : (
        <main className="wrap">
          <header className="top">
            <span className="brand">ReferDesk</span>
            <span className="who">
              {user.name}
              <button className="linkbtn" onClick={() => { localStorage.removeItem("token"); setUser(null); }}>
                Sign out
              </button>
            </span>
          </header>
          <nav className="tabs" aria-label="Sections">
            {tabs.map(([id, label]) => (
              <button key={id} className={current === id ? "on" : ""} aria-current={current === id ? "page" : undefined} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          {current === "find" && <Jobs />}
          {current === "requests" && <MyRequests />}
          {current === "profile" && <Profile />}
          {current === "jobs" && <MyJobs />}
          {current === "post" && <PostJob onPosted={() => setTab("jobs")} />}
        </main>
      )}
    </>
  );
}

/* ---------- Styles ---------- */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@500;600&display=swap');
:root{--ink:#14213D;--paper:#F4F6FA;--rule:#D8DEEA;--teal:#0E7C86;--amber:#E8A33D;--bad:#B3261E;--mute:#56627F}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:400 16px/1.5 'IBM Plex Sans',system-ui,sans-serif;-webkit-text-size-adjust:100%;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
h1,h2,h3,.brand{font-family:'IBM Plex Sans Condensed','IBM Plex Sans',sans-serif;font-weight:600;margin:0}
h2{font-size:22px;margin:16px 0 4px}
h3{font-size:18px}
.wrap{max-width:720px;margin:0 auto;padding:0 16px 56px}
.narrow{padding-top:48px}
.brand{font-size:22px;color:var(--teal)}
.brand.big{font-size:40px;line-height:1.1}
.lede{color:var(--mute);margin:12px 0 28px;max-width:48ch}
.top{display:flex;justify-content:space-between;align-items:center;padding:16px 0}
.who{font-size:14px;color:var(--mute);display:flex;gap:12px;align-items:center}
.linkbtn{background:none;border:0;color:var(--teal);font:inherit;cursor:pointer;text-decoration:underline;padding:0}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--rule);margin-bottom:8px;overflow-x:auto}
.tabs button{background:none;border:0;border-bottom:3px solid transparent;padding:10px 12px;font-weight:500;font-size:15px;font-family:inherit;color:var(--mute);cursor:pointer;white-space:nowrap}
.tabs button.on{color:var(--ink);border-bottom-color:var(--teal)}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,a:focus-visible{outline:3px solid var(--amber);outline-offset:2px}
.row{padding:18px 0;border-bottom:1px solid var(--rule)}
.meta{margin:2px 0;color:var(--mute);font-size:14px}
.skills{margin:6px 0;font-size:14px}
.note{margin:8px 0;padding-left:12px;border-left:3px solid var(--rule);font-size:15px}
.link{display:inline-block;margin:6px 12px 10px 0;color:var(--teal);font-size:14px}
.done-tag{margin:8px 0 0;color:var(--teal);font-weight:500}
.empty{color:var(--mute);padding:24px 0}
.btn{background:var(--teal);color:#fff;border:0;border-radius:6px;padding:11px 18px;font-weight:500;font-size:15px;font-family:inherit;cursor:pointer;margin:8px 8px 0 0}
.btn:disabled{opacity:.6;cursor:default}
.btn.ghost{background:none;color:var(--teal);border:1px solid var(--teal)}
.field{display:block;margin:12px 0;font-size:14px;font-weight:500}
.field input,.field select,.field textarea{display:block;width:100%;margin-top:4px;padding:10px;border:1px solid var(--rule);border-radius:6px;background:#fff;font-weight:400;font-size:16px;font-family:inherit;color:var(--ink)}
.filters,.grid2{display:grid;grid-template-columns:1fr;gap:0 16px}
@media(min-width:560px){.filters,.grid2{grid-template-columns:1fr 1fr}}
.hint{font-size:14px;color:var(--mute);margin:8px 0}
.label{font-size:14px;font-weight:500;margin:16px 0 6px}
.check{display:flex;gap:10px;align-items:flex-start;font-size:14px;margin:12px 0}
.seg{border:0;padding:0;margin:0 0 8px;display:grid;gap:8px}
.seg legend{font-size:14px;font-weight:500;margin-bottom:6px;padding:0}
.seg label{display:flex;gap:10px;align-items:center;padding:12px;border:1px solid var(--rule);border-radius:6px;background:#fff;cursor:pointer}
.seg label.on{border-color:var(--teal);box-shadow:inset 0 0 0 1px var(--teal)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{border:1px solid var(--rule);background:#fff;border-radius:999px;padding:6px 14px;font-weight:400;font-size:14px;font-family:inherit;color:var(--ink);cursor:pointer}
.chip.on{background:var(--ink);border-color:var(--ink);color:#fff}
.notice{margin:10px 0;padding:10px 12px;border-radius:6px;font-size:14px}
.notice.error{background:#FBE9E7;color:var(--bad)}
.notice.ok{background:#E3F4F1;color:#0A5D64}
.match{display:flex;align-items:center;gap:10px;margin:8px 0;font-size:13px;color:var(--mute)}
.track{flex:0 0 120px;height:6px;border-radius:3px;background:var(--rule);overflow:hidden}
.fill{height:100%;background:var(--amber)}
.steps{list-style:none;margin:14px 0 4px;padding:0;display:flex;isolation:isolate}
.steps li{flex:1;position:relative;text-align:center;padding-top:18px;font:500 11px 'IBM Plex Sans Condensed',sans-serif;color:var(--mute)}
.steps li::before{content:"";position:absolute;top:0;left:50%;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:var(--rule)}
.steps li::after{content:"";position:absolute;top:5px;left:-50%;width:100%;height:2px;background:var(--rule);z-index:-1}
.steps li:first-child::after{display:none}
.steps li.done{color:var(--ink)}
.steps li.done::before,.steps li.done::after{background:var(--teal)}
.stopped{margin:10px 0 0;font-size:14px;color:var(--bad)}
@media(prefers-reduced-motion:no-preference){.btn,.chip{transition:background .15s}}
`;

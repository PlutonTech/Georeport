import { useEffect, useRef, useState } from "react";
import "./styles.css";

const api = async (url, opts) => {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
};
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const stamp = () => new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const ROLE = { zone: ["Analysis Zone", "#9333ea"], assets: ["Assets to Measure", "#f97316"], context: ["Context", "#16a34a"], skip: ["Skip", "#94a3b8"] };
const TABS = [["summary", "Summary"], ["map", "Map"], ["charts", "Charts"], ["inventory", "Data Inventory"], ["method", "Methodology"], ["sources", "Data Sources"]];
const NAV = [["home", "Home", "⌂"], ["new", "New Report", "＋"], ["reports", "Reports", "▤"], ["settings", "Settings", "⚙"]];
const COL = ["#2563eb", "#f59e0b", "#16a34a", "#9333ea", "#ef4444", "#0d9488"];

function Donut({ pct }) {
  const C = 2 * Math.PI * 52;
  return (
    <div className="donut"><svg width="130" height="130" viewBox="0 0 130 130">
      <circle cx="65" cy="65" r="52" fill="none" stroke="#cbd5e1" strokeWidth="14" />
      <circle cx="65" cy="65" r="52" fill="none" stroke="#ef4444" strokeWidth="14" strokeDasharray={`${(pct / 100) * C} ${C}`} transform="rotate(-90 65 65)" /></svg>
      <div><b>{pct.toFixed(1)}%</b><span>affected</span></div></div>);
}

function Report({ r }) {
  const [tab, setTab] = useState("summary");
  const go = (id) => { setTab(id); document.getElementById("sec-" + id)?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const tot = r.exposure.reduce((a, e) => a + e.total, 0), hit = r.exposure.reduce((a, e) => a + e.exposed, 0);
  const pct = tot ? (100 * hit) / tot : 0;
  const cat = r.categories[0], cs = cat ? cat.items.reduce((a, i) => a + i.count, 0) : 1, cm = cat ? Math.max(...cat.items.map((i) => i.count)) : 1;
  return (
    <div className="rep">
      <div className="rtop"><span className="doc">▤</span><div><h2>{r.title}</h2><p>{r.subtitle}</p></div>
        <button className="btn ghost" onClick={() => window.print()}>⭳ Export as PDF</button></div>
      <div className="tabs">{TABS.map(([id, t]) => <a key={id} className={tab === id ? "on" : ""} onClick={() => go(id)}>{t}</a>)}
        <span>Generated on<br /><b>{r.generated}</b></span></div>
      <div className="g2">
        <section className="pc" id="sec-summary"><h3>💡 Key Findings</h3><ul>{r.findings.map((t, i) => <li key={i}>{t}</li>)}</ul></section>
        <section className="pc" id="sec-map"><h3>Analysis Map</h3>
          <div className="mapw"><img src={`data:image/png;base64,${r.map}`} alt="Analysis map" />
            <div className="leg">{[["#dc2626", "Zone"], ["#f97316", "Buffer"], ["#2563eb", "Inside buffer"], ["#94a3b8", "Outside"], ["#cbd5e1", "Context"]].map(([c, t]) => <p key={t}><i style={{ background: c }} />{t}</p>)}</div></div></section>
      </div>
      <div className="g3">
        <section className="pc" id="sec-charts"><h3>Exposure Overview</h3>
          {r.exposure.length ? <div className="exp"><Donut pct={pct} />
            <div><p><i style={{ background: "#ef4444" }} />Affected (within {r.buffer} m)<br /><b>{hit.toLocaleString()} ({pct.toFixed(1)}%)</b></p>
              <p><i style={{ background: "#cbd5e1" }} />Not affected<br /><b>{(tot - hit).toLocaleString()} ({(100 - pct).toFixed(1)}%)</b></p></div></div> : <p className="muted">No asset layers selected.</p>}</section>
        <section className="pc"><h3>{cat ? `${cat.layer} by ${cat.field}` : "Categories"}</h3>
          {cat ? <div className="cols">{cat.items.map((i, k) => (
            <div key={i.label}><b>{i.count.toLocaleString()}</b><i style={{ height: `${(i.count / cm) * 110}px`, background: COL[k % 6] }} /><span>{i.label}</span><small>{((100 * i.count) / cs).toFixed(1)}%</small></div>))}</div> : <p className="muted">No category field found.</p>}</section>
        <section className="pc" id="sec-inventory"><h3>Data Inventory</h3>
          <table><thead><tr><th>Layer</th><th>Type</th><th>Features</th></tr></thead><tbody>
            {r.inventory.map((x) => <tr key={x.name + x.role}><td><i className="dot" style={{ background: ROLE[x.role][1] }} />{x.name}</td><td>{x.type}</td><td>{x.features.toLocaleString()}</td></tr>)}</tbody></table></section>
      </div>
      <div className="g2b">
        <section className="pc" id="sec-method"><h3>Methodology</h3>{r.methodology.map((t, i) => <p key={i} className="sm">{t}</p>)}</section>
        <section className="pc" id="sec-sources"><h3>Data Sources</h3><ul className="sm">{r.sources.map((s) => <li key={s.name}>{s.name} · {s.crs} · {s.features.toLocaleString()} features</li>)}</ul></section>
      </div>
    </div>);
}

export default function App() {
  const [view, setView] = useState("new");
  const [layers, setLayers] = useState([]);
  const [job, setJob] = useState("");
  const [roles, setRoles] = useState({});
  const [set, setSet] = useState(() => load("gr_set", { buffer_m: 500, client: "" }));
  const [cfg, setCfg] = useState(() => ({ title: "Spatial Analysis Report", client: set.client, buffer_m: set.buffer_m }));
  const [report, setReport] = useState(null);
  const [hist, setHist] = useState(() => load("gr_hist", []));
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const ctrl = useRef(), input = useRef();
  useEffect(() => { localStorage.setItem("gr_set", JSON.stringify(set)); }, [set]);

  const read = async (list) => {
    if (!list.length) return;
    setBusy("reading"); setErr(""); setReport(null);
    const fd = new FormData();
    [...list].forEach((f) => fd.append("files", f));
    try {
      const d = await api("/api/upload", { method: "POST", body: fd });
      setJob(d.job_id); setLayers(d.layers); setRoles(Object.fromEntries(d.layers.map((l) => [l.id, l.role])));
      if (d.errors.length) setErr(d.errors.join(" | "));
    } catch (e) { setErr(e.message); }
    setBusy("");
  };
  const generate = async () => {
    setBusy("generating"); setErr("");
    ctrl.current = new AbortController();
    try {
      const r = await api(`/api/report/${job}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...cfg, buffer_m: +cfg.buffer_m || 0, roles }), signal: ctrl.current.signal });
      const names = (role) => layers.filter((l) => roles[l.id] === role).map((l) => l.name).join(", ");
      const rep = { ...r, generated: stamp(), buffer: +cfg.buffer_m || 0,
        subtitle: names("zone") ? `${names("assets") || "Layers"} within ${cfg.buffer_m} m of ${names("zone")}` : `Summary of ${names("assets") || names("context")}` };
      setReport(rep);
      const h = [rep, ...hist].slice(0, 5);
      setHist(h);
      try { localStorage.setItem("gr_hist", JSON.stringify(h)); } catch { /* storage full */ }
    } catch (e) { if (e.name !== "AbortError") setErr(e.message); }
    setBusy("");
  };
  const titles = { home: ["Home", "Your GIS reporting workspace"], new: ["Create Report", "Turn your GIS layers into a client-ready report"],
    reports: ["Reports", "Your recent reports"], settings: ["Settings", "Defaults for new reports"] };

  return (
    <div className="app">
      <aside>
        <div className="logo"><span>◆</span>GeoReport</div>
        <nav>{NAV.map(([v, t, ic]) => <a key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}><i>{ic}</i>{t}</a>)}</nav>
        <div className="side-note"><b>Turn your GIS data into client-ready reports.</b><small>Clean · Analyse · Report</small></div>
      </aside>
      <main>
        <header className="top"><div><h1>{titles[view][0]}</h1><p>{titles[view][1]}</p></div><div className="user"><span className="bell">🔔</span><div className="av">SA</div>System Admin</div></header>

        {view === "home" && <div className="page"><div className="pc"><h3>Welcome</h3>
          <p>You have {hist.length} saved report{hist.length === 1 ? "" : "s"}. Upload layers, assign roles and generate a client-ready report in a few clicks.</p>
          <button className="btn" onClick={() => setView("new")}>Create a report</button></div></div>}

        {view === "reports" && <div className="page"><div className="pc"><h3>Recent reports</h3>
          {!hist.length ? <p className="muted">No reports yet.</p> : hist.map((h, i) => (
            <div className="hrow" key={i}><div><b>{h.title}</b><small>{h.subtitle} · {h.generated}</small></div>
              <button className="btn ghost" onClick={() => { setReport(h); setView("new"); }}>Open</button>
              <button className="btn ghost" onClick={() => { const n = hist.filter((_, k) => k !== i); setHist(n); localStorage.setItem("gr_hist", JSON.stringify(n)); }}>Delete</button></div>))}</div></div>}

        {view === "settings" && <div className="page"><div className="pc"><h3>Defaults</h3>
          <label className="lbl">Default buffer distance (m)<input type="number" value={set.buffer_m} onChange={(e) => { setSet({ ...set, buffer_m: e.target.value }); setCfg({ ...cfg, buffer_m: e.target.value }); }} /></label>
          <label className="lbl">Default client name<input value={set.client} onChange={(e) => { setSet({ ...set, client: e.target.value }); setCfg({ ...cfg, client: e.target.value }); }} /></label>
          <p className="muted">Saved in this browser.</p></div></div>}

        {view === "new" && <div className="cols2">
          <div className="left">
            <div className="pc"><h3><b className="n">1</b> Upload Data</h3><p className="muted sm">Add your GIS layers in any supported format</p>
              <div className="drop" onClick={() => input.current.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); read(e.dataTransfer.files); }}>
                ☁<br />{busy === "reading" ? "Reading…" : "Drag and drop files here or click to browse"}<small>GeoPackage, GeoJSON, CSV, Shapefile (zipped)</small></div>
              <input ref={input} type="file" multiple hidden accept=".zip,.gpkg,.geojson,.json,.csv" onChange={(e) => { read(e.target.files); e.target.value = ""; }} />
              {layers.map((l, k) => <div className="frow" key={l.id}><span className="fi" style={{ background: COL[k % 6] }}>{l.type[0]}</span>
                <div><b>{l.name}</b><small>{l.type} · {l.features.toLocaleString()} features</small>{l.dup_of && <em className="dupe">Same data as {l.dup_of}, set to Skip</em>}</div><span className="ok">✔</span></div>)}</div>
            <div className="pc"><h3><b className="n">2</b> Assign Layer Roles</h3><p className="muted sm">Tell us what each layer represents</p>
              {layers.some((l) => l.dup_of) && <div className="info">Some layers look like versions of the same data (80%+ identical geometry). They are set to Skip so features are not counted twice. Change a role to include one.</div>}
              {!layers.length ? <p className="muted sm">Upload data first.</p> : layers.map((l) => (
                <div className="rrow" key={l.id}><i className="dot" style={{ background: ROLE[roles[l.id]][1] }} /><span>{l.name}</span>
                  <select value={roles[l.id]} onChange={(e) => setRoles({ ...roles, [l.id]: e.target.value })}>
                    {Object.entries(ROLE).map(([v, [t]]) => <option key={v} value={v}>{t}</option>)}</select></div>))}</div>
            <div className="pc"><h3><b className="n">3</b> Configure Analysis</h3><p className="muted sm">Set your analysis parameters</p>
              <label className="lbl">Buffer distance<div className="inp"><input type="number" value={cfg.buffer_m} onChange={(e) => setCfg({ ...cfg, buffer_m: e.target.value })} /><em>m</em></div></label>
              <label className="lbl">Analysis type<select><option>Intersection (within buffer)</option></select></label>
              <label className="lbl">Report title<input value={cfg.title} onChange={(e) => setCfg({ ...cfg, title: e.target.value })} /></label>
              <label className="lbl">Client<input value={cfg.client} onChange={(e) => setCfg({ ...cfg, client: e.target.value })} /></label>
              <div className="dl">{busy === "generating" ? <><button className="btn wide" disabled>Generating…</button><button className="btn stop" onClick={() => ctrl.current.abort()}>Stop</button></>
                : <button className="btn wide" disabled={!layers.length || !!busy} onClick={generate}>▶ Generate Report</button>}</div></div>
            {err && <div className="pc errc">{err}</div>}
            <div className="info">ⓘ The report is generated by the GeoReport server. Export it as a PDF using your browser's print dialog.</div>
          </div>
          <div className="right">{report ? <Report r={report} /> : <div className="pc empty"><h3>Your report will appear here</h3><p className="muted">Upload layers, assign roles and click Generate Report.</p></div>}</div>
        </div>}
      </main>
    </div>);
}
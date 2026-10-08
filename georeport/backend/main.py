import base64, io, os, shutil, tempfile, uuid, zipfile
from datetime import date
import geopandas as gpd, numpy as np, pandas as pd, pyogrio
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pyproj import CRS
import shapely
from shapely.geometry import Point, box

app = FastAPI(title="GeoReport")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
JOBS = {}
EXT = (".gpkg", ".geojson", ".json", ".csv", ".shp")


def read_any(path):
    low = path.lower()
    if low.endswith(".csv"):
        df = pd.read_csv(path)
        c = {k.lower(): k for k in df.columns}
        pick = lambda *n: next((c[k] for k in n if k in c), None)
        la, lo = pick("lat", "latitude", "y"), pick("lon", "lng", "long", "longitude", "x")
        if not (la and lo):
            raise ValueError("CSV needs lat/lon columns")
        x, y = pd.to_numeric(df[lo], errors="coerce"), pd.to_numeric(df[la], errors="coerce")
        ok = x.notna() & y.notna()
        yield os.path.splitext(os.path.basename(path))[0], gpd.GeoDataFrame(
            df[ok], geometry=[Point(a, b) for a, b in zip(x[ok], y[ok])], crs=4326)
    elif low.endswith(".gpkg"):
        for name in pyogrio.list_layers(path)[:, 0]:
            yield str(name), gpd.read_file(path, layer=name)
    else:
        yield os.path.splitext(os.path.basename(path))[0], gpd.read_file(path)


def sig(g):
    """Normalised geometry hashes (EPSG:4326, ~1 m grid) for matching layers across files."""
    if g.empty:
        return None
    return set(shapely.to_wkb(shapely.normalize(shapely.set_precision(g.to_crs(4326).geometry.to_numpy(), 1e-5, mode="pointwise"))))


def fix_crs(g):
    g = g[g.geometry.notna() & ~g.geometry.is_empty]
    if g.crs is None:
        if len(g) and abs(g.total_bounds).max() <= 180:
            g = g.set_crs(4326)
        else:
            raise ValueError("no CRS defined (run it through GeoClean first)")
    return g


@app.post("/api/upload")
async def upload(files: list[UploadFile] = File(...)):
    jid, d = uuid.uuid4().hex[:10], tempfile.mkdtemp()
    layers, out, errors = {}, [], []
    for f in files:
        p = os.path.join(d, os.path.basename(f.filename))
        with open(p, "wb") as o:
            shutil.copyfileobj(f.file, o)
        paths = [p]
        if p.lower().endswith(".zip"):
            zipfile.ZipFile(p).extractall(p[:-4])
            paths = [os.path.join(r, n) for r, _, ns in os.walk(p[:-4]) for n in ns if n.lower().endswith(EXT)]
        for q in paths:
            try:
                for name, g in read_any(q):
                    g = fix_crs(g)
                    lid = f"l{len(layers)}"
                    layers[lid] = (name, g)
                    t = g.geom_type.mode()[0] if len(g) else "Empty"
                    out.append({"id": lid, "name": name, "type": t, "features": len(g), "crs": g.crs.to_string(),
                                "role": "zone" if "Polygon" in t and not any(x["role"] == "zone" for x in out) else "assets"})
            except Exception as e:
                errors.append(f"{os.path.basename(q)}: {str(e)[:100]}")
    sigs, kept = {}, []
    for k, (_, g) in layers.items():
        try:
            sigs[k] = sig(g)
        except Exception:
            sigs[k] = None
    for x in out:
        s = sigs.get(x["id"])
        if not s:
            continue
        for a in kept:
            t = sigs[a["id"]]
            if len(s & t) / min(len(s), len(t)) >= 0.8:
                x.update(dup_of=a["name"], role="skip")
                break
        else:
            kept.append(x)
    if not layers:
        raise HTTPException(400, "No readable layers. " + "; ".join(errors))
    JOBS[jid] = layers
    return {"job_id": jid, "layers": out, "errors": errors}


class Cfg(BaseModel):
    title: str = "Spatial Analysis Report"
    client: str = ""
    buffer_m: float = 500
    roles: dict[str, str]


def metrics(g):
    t = g.geom_type.mode()[0] if len(g) else "Empty"
    m = {"features": len(g), "type": t, "size": ""}
    if "Polygon" in t:
        m["size"] = f"{g.area.sum() / 1e6:,.2f} km²"
    elif "Line" in t:
        m["size"] = f"{g.length.sum() / 1e3:,.1f} km"
    return m


def cat_field(g):
    for c in g.columns:
        if c != g.geometry.name and pd.api.types.is_string_dtype(g[c]) and 2 <= g[c].nunique() <= 40:
            return c


def render(ctx, zone, zb, assets, utm):
    fig, ax = plt.subplots(figsize=(7.5, 5))
    s = lambda g, n=4000: g if len(g) <= n else g.sample(n, random_state=0)
    for g in ctx:
        if len(g):
            s(g).plot(ax=ax, color="#cbd5e1", linewidth=.5, markersize=2)
    if zone is not None and len(zone):
        s(zone).plot(ax=ax, color="#dc2626", alpha=.35)
    gpd.GeoSeries([zb], crs=utm).plot(ax=ax, facecolor="none", edgecolor="#f97316", linestyle="--", linewidth=1)
    for a, hit in assets:
        if len(a):
            s(a).plot(ax=ax, color="#94a3b8", markersize=3, linewidth=.8)
        if len(hit):
            s(hit).plot(ax=ax, color="#2563eb", markersize=4, linewidth=1.2)
    ax.set_axis_off()
    ax.set_aspect("equal")
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


@app.post("/api/report/{jid}")
def make_report(jid: str, cfg: Cfg):
    job = JOBS.get(jid)
    if not job:
        raise HTTPException(404, "Unknown job, upload again")
    by = {"zone": [], "assets": [], "context": []}
    for lid, role in cfg.roles.items():
        if role in by and lid in job:
            by[role].append(job[lid])
    if not any(by.values()):
        raise HTTPException(400, "Assign at least one layer a role")
    w = pd.concat([g.to_crs(4326).geometry for v in by.values() for _, g in v])
    b = w.total_bounds
    wide = bool(np.isnan(b).any() or b[2] - b[0] > 12 or b[3] - b[1] > 40)
    utm = CRS("EPSG:6933") if wide else gpd.GeoSeries(w).estimate_utm_crs()  # equal-area for large extents

    def P(g):
        g = g.to_crs(utm)
        return g[np.isfinite(g.bounds).all(axis=1)]
    zone = gpd.GeoDataFrame(pd.concat([P(g)[["geometry"]] for _, g in by["zone"]]), crs=utm) if by["zone"] else None
    allg = pd.concat([P(g).geometry for v in by.values() for _, g in v])
    zb = zone.geometry.union_all().buffer(cfg.buffer_m) if zone is not None else box(*allg.total_bounds)
    area = zb.area / 1e6
    f = [f"The study area covers {area:,.1f} km²" + (f" (analysis zone buffered by {cfg.buffer_m:g} m)." if zone is not None else " (bounding box of the supplied layers).")]
    expo, cats, pairs = [], [], []
    for name, g in by["assets"]:
        a = P(g)
        inside = a[a.intersects(zb)]
        k, n = len(inside), len(a)
        pairs.append((a, inside))
        expo.append({"label": name, "total": n, "exposed": k})
        if zone is not None:
            t = f"{k:,} of {n:,} features in '{name}' ({100 * k / max(n, 1):.1f}%) lie within {cfg.buffer_m:g} m of the zone."
            if "Line" in metrics(a)["type"] and k:
                t += f" That is {inside.intersection(zb).length.sum() / 1e3:,.1f} km of network."
            if "Polygon" in metrics(a)["type"] and k:
                t += f" Intersecting area: {inside.intersection(zb).area.sum() / 1e6:,.2f} km²."
            f.append(t)
        c = cat_field(inside if k else a)
        if c:
            vc = (inside if zone is not None and k else a)[c].value_counts().head(6)
            cats.append({"layer": name, "field": c, "items": [{"label": str(i), "count": int(v)} for i, v in vc.items()]})
            f.append(f"Most common '{c}' in '{name}': {vc.index[0]} ({int(vc.iloc[0]):,}).")
    inv = []
    for role, v in by.items():
        for name, g in v:
            m = metrics(P(g))
            inv.append({"name": name, "role": role, "type": m["type"], "features": m["features"], "size": m["size"], "crs": g.crs.to_string()})
    meth = [f"All layers were reprojected to {utm.to_string()} so distances and areas are in metres.",
            "Layer inventory counts features, and sums length (lines) or area (polygons) per layer."]
    if zone is not None:
        meth.append(f"The analysis zone layer(s) were merged and buffered by {cfg.buffer_m:g} m. Asset features that intersect the buffer are counted as within the zone.")
    if cats:
        meth.append("Category breakdowns use the first text field with 2 to 40 distinct values in each asset layer.")
    meth.append("Map shows up to 4,000 sampled features per layer; counts and totals use all features.")
    if wide:
        meth.append("The data spans a large area, so an equal-area projection (EPSG:6933) was used. Areas are accurate; distances and buffers are approximate away from the equator.")
    img = render([g for _, g in [(n, P(g)) for n, g in by["context"]]], zone, zb, pairs, utm)
    return {"title": cfg.title, "client": cfg.client, "date": date.today().strftime("%d %B %Y"), "findings": f,
            "map": img, "exposure": expo, "categories": cats, "inventory": inv, "methodology": meth,
            "sources": [{"name": r["name"], "crs": r["crs"], "features": r["features"]} for r in inv]}
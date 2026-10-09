# GeoReport

Turn GIS layers into a client-ready report: key findings, map, charts, data inventory, methodology and data sources, exported as a PDF.

## Features
- **Inputs:** GeoPackages (GeoClean output works directly, each layer inside becomes its own item), GeoJSON, CSV with lat/lon, zipped shapefiles. Layers with no CRS are rejected with a hint to run them through GeoClean.
- **Roles:** assign each layer as Analysis Zone, Assets to Measure, Context or Skip.
- **Duplicate detection:** layers sharing 80%+ of their geometry with an earlier layer are flagged and set to Skip, so features are not double counted.
- **Analysis:** buffers the zone by your distance and counts assets inside. Adds length (lines) or area (polygons) within the buffer and a category breakdown.
- **Report:** auto-written findings and methodology, a static map, exposure donut, category chart, inventory and sources.
- **Pages:** Home, New Report, Reports (last 5, saved in the browser) and Settings (default buffer and client).
- **Export PDF** uses the browser print dialog (choose Save as PDF).

## Stack
FastAPI, GeoPandas, Matplotlib (map image). React and Vite (frontend).

## Run locally (PowerShell, one line at a time)
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```
In a second window:
```powershell
cd frontend
npm install
npm run dev
```
Open http://localhost:5174 (ports 8001 and 5174, so it runs alongside GeoClean).

## Using it
1. Add data, then assign roles (the first polygon layer defaults to the zone).
2. Set the buffer distance, title and client, then click **Generate Report**.
3. Click **Export as PDF**.

## API
- `POST /api/upload` (multipart `files`): returns layers with suggested roles and duplicate flags.
- `POST /api/report/{job_id}` (JSON `title`, `client`, `buffer_m`, `roles`): returns the report data and a base64 map image.

## Limitations
- One analysis type (buffer intersection). Without a zone layer, the study area is the bounding box of the data.
- Large extents use an equal-area projection (EPSG:6933), so distances and buffers are approximate away from the equator.
- The map has no basemap and shows up to 4,000 sampled features per layer; counts use all features.
- Findings are templated text. No shareable link yet. Jobs live in memory and are lost on restart; no auth.

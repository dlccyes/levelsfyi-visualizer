const CryptoJS = pm.require('npm:crypto-js@4.2.0');
const pako = pm.require('npm:pako@2.1.0');

function capitalizeFirst(value) {
  if (value == null) return 'N/A';
  const s = String(value).trim();
  if (!s) return 'N/A';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function wordArrayToUint8Array(wordArray) {
  const { words, sigBytes } = wordArray;
  const out = new Uint8Array(sigBytes);

  for (let i = 0; i < sigBytes; i++) {
    out[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }

  return out;
}

function decodeLevelsPayload(responseJson) {
  if (!responseJson || !responseJson.payload) {
    throw new Error('Response JSON does not contain payload');
  }

  const secret = 'levelstothemoon!!';
  const md5 = CryptoJS.MD5(secret);
  const keyStr = CryptoJS.enc.Base64.stringify(md5).slice(0, 16);
  const key = CryptoJS.enc.Utf8.parse(keyStr);
  const ciphertext = CryptoJS.enc.Base64.parse(responseJson.payload);

  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext },
    key,
    {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7
    }
  );

  const compressedBytes = wordArrayToUint8Array(decrypted);
  const jsonText = pako.inflate(compressedBytes, { to: 'string' });
  return JSON.parse(jsonText);
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return sortedValues[lower];

  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function formatUSD(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'N/A';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  });
}

function formatUSDCompact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'N/A';

  if (Math.abs(n) >= 1000000) {
    return '$' + (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }

  return '$' + Math.round(n / 1000).toLocaleString('en-US') + 'K';
}

function formatInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'N/A';
  return n.toLocaleString('en-US');
}

function getRequestBodyJson() {
  try {
    if (!pm.request || !pm.request.body || pm.request.body.mode !== 'raw') return null;
    const raw = pm.request.body.raw;
    if (!raw || !raw.trim()) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function getQueryParamMap() {
  const out = {};
  try {
    const query = pm.request.url.query ? pm.request.url.query.all() : [];
    query.forEach(q => {
      if (!q || !q.key) return;

      if (Object.prototype.hasOwnProperty.call(out, q.key)) {
        if (!Array.isArray(out[q.key])) out[q.key] = [out[q.key]];
        out[q.key].push(q.value);
      } else {
        out[q.key] = q.value;
      }
    });
  } catch (e) {
    return {};
  }
  return out;
}

function deepGet(obj, path) {
  if (!obj) return undefined;
  return path.split('.').reduce((acc, key) => {
    if (acc == null) return undefined;
    return acc[key];
  }, obj);
}

function firstDefined(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function getDashboardParams(rawResponseJson) {
  const requestBody = getRequestBodyJson();
  const queryParams = getQueryParamMap();

  const paramsContainer = firstDefined(
    rawResponseJson && rawResponseJson.params,
    requestBody && requestBody.params,
    requestBody
  ) || {};

  const companySlug = firstDefined(
    deepGet(paramsContainer, 'companySlug'),
    deepGet(paramsContainer, 'company.slug'),
    queryParams.companySlug
  );

  const levelSlug = firstDefined(
    deepGet(paramsContainer, 'levelSlug'),
    queryParams.levelSlug
  );

  const dmaIdsRaw = firstDefined(
    deepGet(paramsContainer, 'dmaIds'),
    paramsContainer['dmaIds[]'],
    queryParams.dmaIds,
    queryParams['dmaIds[]']
  );

  const minYearsOfExp = firstDefined(
    deepGet(paramsContainer, 'minYearsOfExp'),
    deepGet(paramsContainer, 'minYearsOfExperience'),
    queryParams.minYearsOfExp,
    queryParams.minYearsOfExperience
  );

  const maxYearsOfExp = firstDefined(
    deepGet(paramsContainer, 'maxYearsOfExp'),
    deepGet(paramsContainer, 'maxYearsOfExperience'),
    queryParams.maxYearsOfExp,
    queryParams.maxYearsOfExperience
  );

  return {
    companySlug: companySlug || 'N/A',
    levelSlug: Array.isArray(levelSlug) ? levelSlug.join(', ') : (levelSlug || 'N/A'),
    dmaIds: Array.isArray(dmaIdsRaw) ? dmaIdsRaw.join(', ') : (dmaIdsRaw || 'N/A'),
    minYearsOfExp: minYearsOfExp ?? 'N/A',
    maxYearsOfExp: maxYearsOfExp ?? 'N/A'
  };
}

function summarizeLevels(rows) {
  const counts = {};
  rows.forEach(r => {
    const key = r.level || 'Unknown';
    counts[key] = (counts[key] || 0) + 1;
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([level, count]) => ({ level, count }));
}

function summarizeLocations(rows) {
  const counts = {};
  rows.forEach(r => {
    const key = r.location || 'Unknown';
    counts[key] = (counts[key] || 0) + 1;
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([location, count]) => ({ location, count }));
}

function summarizeField(rows, field, limit = 8) {
  const counts = {};
  rows.forEach(r => {
    const raw = r[field];
    const key = raw == null || raw === '' ? 'Unknown' : String(raw);
    counts[key] = (counts[key] || 0) + 1;
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function buildSampleRows(rows) {
  return rows.slice(0, 10).map(r => ({
    company: r.company || '',
    level: r.level || '',
    yoe: r.yearsOfExperience,
    location: r.location || '',
    totalCompensation: formatUSD(r.totalCompensation),
    baseSalary: formatUSD(r.baseSalary)
  }));
}

function buildTcDistributionPlot(tcValues) {
  const values = [...tcValues].sort((a, b) => a - b);
  const count = values.length;

  const width = 860;
  const height = 330;
  const marginLeft = 58;
  const marginRight = 38;
  const marginTop = 30;
  const marginBottom = 56;
  const plotWidth = width - marginLeft - marginRight;

  if (!count) {
    return {
      width,
      height,
      hasData: false
    };
  }

  const min = values[0];
  const max = values[count - 1];
  const q1 = percentile(values, 0.25);
  const median = percentile(values, 0.50);
  const q3 = percentile(values, 0.75);

  const boxCenterY = 135;
  const boxHeight = 96;
  const boxTopY = boxCenterY - boxHeight / 2;
  const boxBottomY = boxCenterY + boxHeight / 2;
  const axisY = 270;

  const rawRange = Math.max(max - min, 1);
  const domainPadding = Math.max(rawRange * 0.12, 8000);
  const domainMin = Math.max(0, min - domainPadding);
  const domainMax = max + domainPadding;
  const domainRange = Math.max(domainMax - domainMin, 1);

  function xScale(v) {
    return marginLeft + ((v - domainMin) / domainRange) * plotWidth;
  }

  const minX = xScale(min);
  const q1X = xScale(q1);
  const medianX = xScale(median);
  const q3X = xScale(q3);
  const maxX = xScale(max);

  const dotOffsets = [-42, -20, 0, 20, 42, -30, 30, -10, 10];
  const dots = values.map((v, i) => ({
    cx: xScale(v),
    cy: boxCenterY + dotOffsets[i % dotOffsets.length],
    label: formatUSDCompact(v)
  }));

  const tickCount = 5;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const t = i / (tickCount - 1);
    const rawValue = domainMin + domainRange * t;
    const roundedValue = Math.round(rawValue / 1000) * 1000;

    return {
      x: xScale(rawValue),
      label: formatUSDCompact(roundedValue)
    };
  });

  return {
    hasData: true,
    width,
    height,
    marginTop,
    axisY,
    boxCenterY,
    boxTopY,
    boxBottomY,
    boxHeight,
    minX,
    q1X,
    medianX,
    q3X,
    maxX,
    boxWidth: Math.max(q3X - q1X, 1),
    q1Label: formatUSDCompact(q1),
    medianLabel: formatUSDCompact(median),
    q3Label: formatUSDCompact(q3),
    ticks,
    dots
  };
}

try {
  const raw = pm.response.json();
  const decoded = decodeLevelsPayload(raw);
  const params = getDashboardParams(raw);

  const rows = Array.isArray(decoded.rows) ? decoded.rows : [];

  const tcValues = rows
    .map(r => Number(r.totalCompensation))
    .filter(v => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  const yoeValues = rows
    .map(r => Number(r.yearsOfExperience))
    .filter(v => Number.isFinite(v))
    .sort((a, b) => a - b);

  const count = tcValues.length;
  const avgTC = count ? tcValues.reduce((sum, v) => sum + v, 0) / count : 0;
  const q1 = percentile(tcValues, 0.25);
  const median = percentile(tcValues, 0.50);
  const q3 = percentile(tcValues, 0.75);
  const minTC = count ? tcValues[0] : 0;
  const maxTC = count ? tcValues[count - 1] : 0;
  const minYoe = yoeValues.length ? yoeValues[0] : null;
  const maxYoe = yoeValues.length ? yoeValues[yoeValues.length - 1] : null;

  const levelSummary = summarizeLevels(rows);
  const genderSummary = summarizeField(rows, 'gender');
  const ethnicitySummary = summarizeField(rows, 'ethnicity');
  const locationSummary = summarizeLocations(rows);
  const sampleRows = buildSampleRows(rows);
  const plot = buildTcDistributionPlot(tcValues);

  pm.collectionVariables.set('levels_decoded_json', JSON.stringify(decoded));
  pm.collectionVariables.set('levels_avg_tc', String(avgTC));
  pm.collectionVariables.set('levels_q1_tc', String(q1));
  pm.collectionVariables.set('levels_median_tc', String(median));
  pm.collectionVariables.set('levels_q3_tc', String(q3));

  console.log('Decoded Levels JSON:', decoded);
  console.log('Dashboard params:', params);
  console.log('Average TC:', formatUSD(avgTC));
  console.log('Q1 TC:', formatUSD(q1));
  console.log('Median TC:', formatUSD(median));
  console.log('Q3 TC:', formatUSD(q3));

  pm.visualizer.set(
    `
    <style>
      :root {
        --bg: #0b1220;
        --panel: #111827;
        --panel-2: #0f172a;
        --border: #334155;
        --text: #f8fafc;
        --muted: #94a3b8;
        --accent: #93c5fd;
        --good: #86efac;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        padding: 18px;
        background: var(--bg);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      h1, h2, h3 {
        margin: 0 0 10px 0;
        font-weight: 700;
      }

      .header {
        margin-bottom: 16px;
        padding: 16px 18px;
        background: linear-gradient(180deg, #111827 0%, #0f172a 100%);
        border: 1px solid var(--border);
        border-radius: 12px;
      }

      .sub {
        color: var(--muted);
        font-size: 13px;
        margin-top: 6px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(12, 1fr);
        gap: 12px;
      }

      .card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 14px 16px;
      }

      .span-12 { grid-column: span 12; }
      .span-8 { grid-column: span 8; }
      .span-6 { grid-column: span 6; }
      .span-4 { grid-column: span 4; }
      .span-3 { grid-column: span 3; }

      .metric-label {
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 8px;
      }

      .metric-value {
        font-size: 26px;
        font-weight: 800;
        line-height: 1.1;
      }

      .metric-sub {
        margin-top: 8px;
        color: var(--muted);
        font-size: 12px;
      }

      .filters {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 14px;
      }

      .kv {
        background: var(--panel-2);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px 12px;
      }

      .kv .k {
        display: block;
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 4px;
      }

      .kv .v {
        display: block;
        color: var(--text);
        font-size: 14px;
        font-weight: 600;
        word-break: break-word;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th, td {
        text-align: left;
        padding: 10px 8px;
        border-bottom: 1px solid #243041;
        font-size: 13px;
        vertical-align: top;
      }

      th {
        color: var(--muted);
        font-weight: 700;
      }

      tr:last-child td {
        border-bottom: none;
      }

      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }

      .json {
        white-space: pre-wrap;
        overflow-x: auto;
        max-height: 520px;
        background: #0a1020;
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 14px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 12px;
        line-height: 1.45;
      }

      .plot-card {
        padding: 16px;
      }

      .plot-shell {
        background: #f3f4f6;
        border-radius: 10px;
        border: 1px solid #d1d5db;
        overflow: hidden;
      }

      .plot-shell svg {
        display: block;
        width: 100%;
        height: auto;
      }

      .plot-grid {
        stroke: #d1d5db;
        stroke-width: 1;
      }

      .plot-axis {
        stroke: #c7c7c7;
        stroke-width: 1.5;
      }

      .plot-whisker {
        stroke: #a3a3a3;
        stroke-width: 2.2;
      }

      .plot-box {
        fill: rgba(156, 163, 175, 0.18);
        stroke: #a3a3a3;
        stroke-width: 2.2;
      }

      .plot-median {
        stroke: #8f8f8f;
        stroke-width: 2.2;
      }

      .plot-dot {
        fill: rgba(74, 174, 97, 0.88);
      }

      .plot-tick-label {
        fill: #7c7c7c;
        font-size: 11px;
        text-anchor: middle;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .plot-stat-label {
        fill: #808080;
        font-size: 12px;
        text-anchor: middle;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .plot-stat-value {
        fill: #7b7b7b;
        font-size: 13px;
        text-anchor: middle;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .muted {
        color: var(--muted);
      }

      @media (max-width: 1000px) {
        .span-8, .span-6, .span-4, .span-3 {
          grid-column: span 12;
        }

        .filters {
          grid-template-columns: 1fr;
        }
      }
    </style>

    <div class="header">
      <h1>{{companySlug}} TC Dashboard</h1>
      <div class="sub">
        levelSlug: <span class="mono">{{levelSlug}}</span>
        &nbsp; | &nbsp;
        minYearsOfExp: <span class="mono">{{minYearsOfExp}}</span>
        &nbsp; | &nbsp;
        maxYearsOfExp: <span class="mono">{{maxYearsOfExp}}</span>
        &nbsp; | &nbsp;
        dmaIds[]: <span class="mono">{{dmaIds}}</span>
      </div>
    </div>

    <div class="grid">
      <div class="card span-3">
        <div class="metric-label">Average TC</div>
        <div class="metric-value">{{avgTC}}</div>
        <div class="metric-sub">Computed from returned rows</div>
      </div>

      <div class="card span-3">
        <div class="metric-label">Q1</div>
        <div class="metric-value">{{q1}}</div>
        <div class="metric-sub">25th percentile</div>
      </div>

      <div class="card span-3">
        <div class="metric-label">Median</div>
        <div class="metric-value">{{median}}</div>
        <div class="metric-sub">50th percentile</div>
      </div>

      <div class="card span-3">
        <div class="metric-label">Q3</div>
        <div class="metric-value">{{q3}}</div>
        <div class="metric-sub">75th percentile</div>
      </div>

      <div class="card span-3">
        <div class="metric-label">Min TC</div>
        <div class="metric-value">{{minTC}}</div>
        <div class="metric-sub">Lowest returned total compensation</div>
      </div>

      <div class="card span-3">
        <div class="metric-label">Max TC</div>
        <div class="metric-value">{{maxTC}}</div>
        <div class="metric-sub">Highest returned total compensation</div>
      </div>

      <div class="card span-3">
        <div class="metric-label">Rows Used</div>
        <div class="metric-value">{{rowCount}}</div>
        <div class="metric-sub">Rows with numeric TC</div>
      </div>

      <div class="card span-3">
        <div class="metric-label">Response Total</div>
        <div class="metric-value">{{responseTotal}}</div>
        <div class="metric-sub">Total matching rows reported by API</div>
      </div>

      <div class="card span-12 plot-card">
        <h2>TC Distribution</h2>
        <div class="plot-shell">
          {{#if plot.hasData}}
          <svg viewBox="0 0 {{plot.width}} {{plot.height}}" preserveAspectRatio="xMidYMid meet">
            {{#each plot.ticks}}
              <line class="plot-grid" x1="{{x}}" y1="{{../plot.marginTop}}" x2="{{x}}" y2="{{../plot.axisY}}" />
              <text class="plot-tick-label" x="{{x}}" y="{{../plot.axisY}}">{{label}}</text>
            {{/each}}

            <line class="plot-axis" x1="{{plot.minX}}" y1="{{plot.axisY}}" x2="{{plot.maxX}}" y2="{{plot.axisY}}" />

            <line class="plot-whisker" x1="{{plot.minX}}" y1="{{plot.boxCenterY}}" x2="{{plot.q1X}}" y2="{{plot.boxCenterY}}" />
            <line class="plot-whisker" x1="{{plot.q3X}}" y1="{{plot.boxCenterY}}" x2="{{plot.maxX}}" y2="{{plot.boxCenterY}}" />

            <line class="plot-whisker" x1="{{plot.minX}}" y1="{{plot.boxTopY}}" x2="{{plot.minX}}" y2="{{plot.boxBottomY}}" />
            <line class="plot-whisker" x1="{{plot.maxX}}" y1="{{plot.boxTopY}}" x2="{{plot.maxX}}" y2="{{plot.boxBottomY}}" />

            <rect class="plot-box" x="{{plot.q1X}}" y="{{plot.boxTopY}}" width="{{plot.boxWidth}}" height="{{plot.boxHeight}}" />

            <line class="plot-median" x1="{{plot.medianX}}" y1="{{plot.boxTopY}}" x2="{{plot.medianX}}" y2="{{plot.boxBottomY}}" />

            {{#each plot.dots}}
              <circle class="plot-dot" cx="{{cx}}" cy="{{cy}}" r="10" />
            {{/each}}

            <text class="plot-stat-value" x="{{plot.q1X}}" y="36">{{plot.q1Label}}</text>
            <text class="plot-stat-value" x="{{plot.medianX}}" y="78">{{plot.medianLabel}}</text>
            <text class="plot-stat-value" x="{{plot.q3X}}" y="36">{{plot.q3Label}}</text>

            <text class="plot-stat-label" x="{{plot.q1X}}" y="244">25th</text>
            <text class="plot-stat-label" x="{{plot.medianX}}" y="208">Med</text>
            <text class="plot-stat-label" x="{{plot.q3X}}" y="244">75th</text>
          </svg>
          {{else}}
          <div style="padding: 20px; color: #6b7280;">No TC data available for the plot.</div>
          {{/if}}
        </div>
      </div>

      <div class="card span-6">
        <h2>Returned Data Summary</h2>
        <div class="filters">
          <div class="kv">
            <span class="k">Visible rows returned</span>
            <span class="v">{{returnedRows}}</span>
          </div>
          <div class="kv">
            <span class="k">Hidden rows</span>
            <span class="v">{{hiddenRows}}</span>
          </div>
          <div class="kv">
            <span class="k">Min yearsOfExperience in rows</span>
            <span class="v">{{minYoe}}</span>
          </div>
          <div class="kv">
            <span class="k">Max yearsOfExperience in rows</span>
            <span class="v">{{maxYoe}}</span>
          </div>
        </div>
      </div>

      <div class="card span-4">
        <h2>Top Levels</h2>
        <table>
          <thead>
            <tr>
              <th>Level</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {{#each levelSummary}}
              <tr>
                <td class="mono">{{level}}</td>
                <td>{{count}}</td>
              </tr>
            {{/each}}
          </tbody>
        </table>
      </div>

      <div class="card span-6">
        <h2>Top Locations</h2>
        <table>
          <thead>
            <tr>
              <th>Location</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {{#each locationSummary}}
              <tr>
                <td>{{location}}</td>
                <td>{{count}}</td>
              </tr>
            {{/each}}
          </tbody>
        </table>
      </div>

      <div class="card span-4">
        <h2>Top Gender</h2>
        <table>
          <thead>
            <tr>
              <th>Gender</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {{#each genderSummary}}
              <tr>
                <td>{{value}}</td>
                <td>{{count}}</td>
              </tr>
            {{/each}}
          </tbody>
        </table>
      </div>

      <div class="card span-4">
        <h2>Top Ethnicity</h2>
        <table>
          <thead>
            <tr>
              <th>Ethnicity</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {{#each ethnicitySummary}}
              <tr>
                <td>{{value}}</td>
                <td>{{count}}</td>
              </tr>
            {{/each}}
          </tbody>
        </table>
      </div>

      <div class="card span-12">
        <h2>Sample Rows</h2>
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Level</th>
              <th>YoE</th>
              <th>Location</th>
              <th>Total Comp</th>
              <th>Base</th>
            </tr>
          </thead>
          <tbody>
            {{#each sampleRows}}
              <tr>
                <td>{{company}}</td>
                <td class="mono">{{level}}</td>
                <td>{{yoe}}</td>
                <td>{{location}}</td>
                <td>{{totalCompensation}}</td>
                <td>{{baseSalary}}</td>
              </tr>
            {{/each}}
          </tbody>
        </table>
      </div>

      <div class="card span-12">
        <h2>Decoded JSON</h2>
        <div class="json">{{body}}</div>
      </div>
    </div>
    `,
    {
      avgTC: formatUSD(avgTC),
      q1: formatUSD(q1),
      median: formatUSD(median),
      q3: formatUSD(q3),
      minTC: formatUSD(minTC),
      maxTC: formatUSD(maxTC),
      rowCount: formatInt(count),
      responseTotal: formatInt(decoded.total),
      returnedRows: formatInt(rows.length),
      hiddenRows: formatInt(decoded.hidden),
      minYoe: minYoe == null ? 'N/A' : String(minYoe),
      maxYoe: maxYoe == null ? 'N/A' : String(maxYoe),
      companySlug: capitalizeFirst(params.companySlug),
      levelSlug: params.levelSlug,
      minYearsOfExp: String(params.minYearsOfExp),
      maxYearsOfExp: String(params.maxYearsOfExp),
      dmaIds: params.dmaIds,
      levelSummary,
      locationSummary,
      genderSummary,
      ethnicitySummary,
      sampleRows,
      plot,
      body: JSON.stringify(decoded, null, 2)
    }
  );

  pm.test('Levels payload decoded', function () {
    pm.expect(decoded).to.be.an('object');
    pm.expect(decoded.rows).to.be.an('array');
  });

  pm.test('TC stats calculated', function () {
    pm.expect(count).to.be.above(0);
  });

} catch (e) {
  console.error('Decode failed:', e);
  pm.test('Levels payload decoded', function () {
    throw e;
  });
}

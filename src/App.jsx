import { useMemo, useState } from "react";
import CryptoJS from "crypto-js";
import pako from "pako";
import PropTypes from "prop-types";

const LOCATION_OPTIONS = [{ label: "SF Bay Area", value: "807" }];

const STATIC_QUERY_PARAMS = {
  limit: "50",
  sortBy: "offer_date",
  sortOrder: "DESC",
  jobFamilySlug: "software-engineer",
  currency: "USD",
};

const LEVELS_API_PROXY_PATH = "/api/levels/v3/salary/search";
const LEVELS_API_PROXY_ORIGIN = "https://levelsfyi-proxy.derricken968.workers.dev";
const LEVELS_API_PATH = "/v3/salary/search";

function isLocalhost() {
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function wordArrayToUint8Array(wordArray) {
  const { words, sigBytes } = wordArray;
  const out = new Uint8Array(sigBytes);
  for (let i = 0; i < sigBytes; i += 1) {
    out[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return out;
}

function decodeLevelsPayload(responseJson) {
  if (!responseJson?.payload) {
    throw new Error("Response JSON does not contain payload.");
  }

  const secret = "levelstothemoon!!";
  const md5 = CryptoJS.MD5(secret);
  const keyStr = CryptoJS.enc.Base64.stringify(md5).slice(0, 16);
  const key = CryptoJS.enc.Utf8.parse(keyStr);
  const ciphertext = CryptoJS.enc.Base64.parse(responseJson.payload);

  const decrypted = CryptoJS.AES.decrypt({ ciphertext }, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });

  const compressedBytes = wordArrayToUint8Array(decrypted);
  const jsonText = pako.inflate(compressedBytes, { to: "string" });
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
  if (!Number.isFinite(n)) return "N/A";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return n.toLocaleString("en-US");
}

function formatUSDCompact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  if (Math.abs(n) >= 1000000) {
    return `$${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  return `$${Math.round(n / 1000).toLocaleString("en-US")}K`;
}

function summarizeField(rows, field, limit = 8) {
  const counts = {};
  rows.forEach((row) => {
    const raw = row[field];
    const key = raw == null || raw === "" ? "Unknown" : String(raw);
    counts[key] = (counts[key] ?? 0) + 1;
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function buildRequestUrl(formState) {
  const companySlug = formState.company
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, "-");
  const params = new URLSearchParams({
    minYearsOfExp: String(formState.minYearsOfExp),
    maxYearsOfExp: String(formState.maxYearsOfExp),
    companySlug,
    ...STATIC_QUERY_PARAMS,
  });
  params.append("dmaIds[]", formState.dmaId);
  const url = isLocalhost()
    ? new URL(LEVELS_API_PROXY_PATH, window.location.origin)
    : new URL(LEVELS_API_PATH, LEVELS_API_PROXY_ORIGIN);
  url.search = params.toString();
  return url.toString();
}

function buildHeaders(token) {
  const normalizedToken = token.replace(/^Bearer\s+/i, "").trim();
  return {
    Accept: "application/json, text/plain, */*",
    Authorization: `Bearer ${normalizedToken}`,
    "x-agent": "levelsfyi_website",
  };
}

function buildSampleRows(rows) {
  return rows.map((row, index) => {
    const parsedOfferDate = Date.parse(row.offerDate || "");
    const hasValidOfferDate = Number.isFinite(parsedOfferDate);

    return {
    id: `${row.company || "unknown"}-${row.level || "unknown"}-${row.location || "unknown"}-${index}`,
    company: row.company || "",
    level: row.level || "",
    yoe: Number(row.yearsOfExperience),
    location: row.location || "",
    totalCompensationValue: Number(row.totalCompensation),
    baseSalaryValue: Number(row.baseSalary),
    totalCompensation: formatUSD(row.totalCompensation),
    baseSalary: formatUSD(row.baseSalary),
    offerDate: hasValidOfferDate ? new Date(parsedOfferDate).toLocaleString() : "N/A",
    offerDateValue: hasValidOfferDate ? parsedOfferDate : Number.NEGATIVE_INFINITY,
    };
  });
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
    return { width, height, hasData: false };
  }

  const min = values[0];
  const max = values[count - 1];
  const q1 = percentile(values, 0.25);
  const median = percentile(values, 0.5);
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
    label: formatUSDCompact(v),
  }));

  const tickCount = 5;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const t = i / (tickCount - 1);
    const rawValue = domainMin + domainRange * t;
    const roundedValue = Math.round(rawValue / 1000) * 1000;
    return {
      x: xScale(rawValue),
      label: formatUSDCompact(roundedValue),
    };
  });

  return {
    hasData: true,
    width,
    height,
    marginTop,
    marginBottom,
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
    dots,
  };
}

function getCopyButtonLabel(status) {
  if (status === "loading") return "Copying...";
  if (status === "success") return "Copied!";
  return "Copy JSON";
}

function compareValues(a, b, direction) {
  if (a === b) return 0;
  const left = a == null ? "" : a;
  const right = b == null ? "" : b;

  let result = 0;
  if (typeof left === "number" && typeof right === "number") {
    result = left - right;
  } else {
    result = String(left).localeCompare(String(right), undefined, { sensitivity: "base" });
  }

  return direction === "asc" ? result : -result;
}

function App() {
  const [formState, setFormState] = useState({
    bearerToken: "",
    company: "bytedance",
    minYearsOfExp: "2",
    maxYearsOfExp: "4",
    dmaId: LOCATION_OPTIONS[0].value,
  });
  const [rawResponse, setRawResponse] = useState(null);
  const [decodedResponse, setDecodedResponse] = useState(null);
  const [requestError, setRequestError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState({
    decodedCopy: "idle",
    decodedOpen: "idle",
    rawCopy: "idle",
    rawOpen: "idle",
  });
  const [sampleSort, setSampleSort] = useState({
    field: "totalCompensationValue",
    direction: "desc",
  });

  function setTransientActionStatus(key, value) {
    setActionStatus((prev) => ({ ...prev, [key]: value }));
    globalThis.setTimeout(() => {
      setActionStatus((prev) => ({ ...prev, [key]: "idle" }));
    }, 1200);
  }

  const computed = useMemo(() => {
    if (!decodedResponse) return null;
    const rows = Array.isArray(decodedResponse.rows) ? decodedResponse.rows : [];
    const tcValues = rows
      .map((r) => Number(r.totalCompensation))
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);

    const yoeValues = rows
      .map((r) => Number(r.yearsOfExperience))
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);

    const count = tcValues.length;
    const avgTC = count ? tcValues.reduce((sum, value) => sum + value, 0) / count : 0;

    return {
      rows,
      count,
      avgTC,
      q1: percentile(tcValues, 0.25),
      median: percentile(tcValues, 0.5),
      q3: percentile(tcValues, 0.75),
      minTC: count ? tcValues[0] : 0,
      maxTC: count ? tcValues[count - 1] : 0,
      minYoe: yoeValues.length ? yoeValues[0] : null,
      maxYoe: yoeValues.length ? yoeValues[yoeValues.length - 1] : null,
      levelSummary: summarizeField(rows, "level"),
      locationSummary: summarizeField(rows, "location"),
      genderSummary: summarizeField(rows, "gender"),
      ethnicitySummary: summarizeField(rows, "ethnicity"),
      sampleRows: buildSampleRows(rows),
      plot: buildTcDistributionPlot(tcValues),
    };
  }, [decodedResponse]);

  const sortedSampleRows = useMemo(() => {
    if (!computed) return [];
    const rows = [...computed.sampleRows];
    rows.sort((a, b) => compareValues(a[sampleSort.field], b[sampleSort.field], sampleSort.direction));
    return rows;
  }, [computed, sampleSort]);

  function toggleSampleSort(field) {
    setSampleSort((prev) => {
      if (prev.field === field) {
        return {
          field,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      return { field, direction: "desc" };
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setRequestError("");
    setIsLoading(true);
    setRawResponse(null);
    setDecodedResponse(null);

    try {
      const bearerToken = formState.bearerToken.trim();
      if (!bearerToken) {
        throw new Error("Bearer token is required.");
      }

      const url = buildRequestUrl(formState);
      const response = await fetch(url, { headers: buildHeaders(bearerToken) });
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}.`);
      }

      const responseJson = await response.json();
      const decoded = decodeLevelsPayload(responseJson);
      setRawResponse(responseJson);
      setDecodedResponse(decoded);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Unexpected request error.");
    } finally {
      setIsLoading(false);
    }
  }

  function openDecodedJsonInNewPage() {
    if (!decodedResponse) return;
    const jsonText = JSON.stringify(decodedResponse, null, 2);
    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setTransientActionStatus("decodedOpen", "success");
  }

  function openRawApiJsonInNewPage() {
    if (!rawResponse) return;
    const jsonText = JSON.stringify(rawResponse, null, 2);
    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setTransientActionStatus("rawOpen", "success");
  }

  async function copyJsonToClipboard(value, key) {
    if (!value) return;
    const jsonText = JSON.stringify(value, null, 2);
    try {
      setActionStatus((prev) => ({ ...prev, [key]: "loading" }));
      await navigator.clipboard.writeText(jsonText);
      setTransientActionStatus(key, "success");
    } catch (error) {
      setTransientActionStatus(key, "error");
      setRequestError(error instanceof Error ? error.message : "Failed to copy JSON.");
    }
  }

  return (
    <main className="page">
      <section className="panel">
        <h1>Levels.fyi Visualizer</h1>
        <p>
          Enter company and YoE range. Location is currently restricted to SF Bay Area and maps to
          {" "}
          <code>dmaIds[]=807</code>.
        </p>
        <form onSubmit={handleSubmit} className="form">
          <div className="span-2 token-field">
            <div className="token-label-row">
              <label htmlFor="bearer-token-input">Bearer Token</label>
              <button
                type="button"
                className="info-icon-button"
                aria-label="Bearer token help"
              >
                <span aria-hidden="true">i</span>
                <span className="info-tooltip-content" role="tooltip">
                  Get this from a real Levels.fyi browser request: open DevTools, inspect a request
                  to the salary API, and copy the value of the `Authorization` header.
                </span>
              </button>
            </div>
            <input
              id="bearer-token-input"
              className="input-token"
              type="password"
              value={formState.bearerToken}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, bearerToken: event.target.value }))
              }
              placeholder="Paste Bearer token (without or with Bearer prefix)"
              required
            />
          </div>
          <label>
            <span>Company</span>
            <input
              value={formState.company}
              onChange={(event) => setFormState((prev) => ({ ...prev, company: event.target.value }))}
              required
            />
          </label>
          <label>
            <span>Min YoE</span>
            <input
              className="input-yoe"
              type="number"
              min="0"
              value={formState.minYearsOfExp}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, minYearsOfExp: event.target.value }))
              }
              required
            />
          </label>
          <label>
            <span>Max YoE</span>
            <input
              className="input-yoe"
              type="number"
              min="0"
              value={formState.maxYearsOfExp}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, maxYearsOfExp: event.target.value }))
              }
              required
            />
          </label>
          <label>
            <span>Location</span>
            <select
              value={formState.dmaId}
              onChange={(event) => setFormState((prev) => ({ ...prev, dmaId: event.target.value }))}
            >
              {LOCATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={isLoading}>
            {isLoading ? "Loading..." : "Fetch and Decode"}
          </button>
        </form>
        {requestError && <p className="error">{requestError}</p>}
      </section>

      {computed && (
        <>
          <section className="grid metrics">
            <article className="panel metric">
              <h2>Average TC</h2>
              <div>{formatUSD(computed.avgTC)}</div>
            </article>
            <article className="panel metric">
              <h2>Q1</h2>
              <div>{formatUSD(computed.q1)}</div>
            </article>
            <article className="panel metric">
              <h2>Median</h2>
              <div>{formatUSD(computed.median)}</div>
            </article>
            <article className="panel metric">
              <h2>Q3</h2>
              <div>{formatUSD(computed.q3)}</div>
            </article>
            <article className="panel metric">
              <h2>Min / Max TC</h2>
              <div>
                {formatUSD(computed.minTC)} / {formatUSD(computed.maxTC)}
              </div>
            </article>
            <article className="panel metric">
              <h2>Rows Used</h2>
              <div>{formatInt(computed.count)}</div>
            </article>
            <article className="panel metric">
              <h2>Response Total</h2>
              <div>{formatInt(decodedResponse.total)}</div>
            </article>
          </section>

          <section className="panel">
            <h2>TC Distribution</h2>
            <BoxPlot plot={computed.plot} />
          </section>

          <section className="grid">
            <article className="panel">
              <h2>Top Levels</h2>
              <SummaryTable title="Level" rows={computed.levelSummary} />
            </article>
            <article className="panel">
              <h2>Top Locations</h2>
              <SummaryTable title="Location" rows={computed.locationSummary} />
            </article>
            <article className="panel">
              <h2>Top Gender</h2>
              <SummaryTable title="Gender" rows={computed.genderSummary} />
            </article>
            <article className="panel">
              <h2>Top Ethnicity</h2>
              <SummaryTable title="Ethnicity" rows={computed.ethnicitySummary} />
            </article>
          </section>

          <section className="panel">
            <h2>Sample Rows</h2>
            <SampleRowsTable
              rows={sortedSampleRows}
              sortField={sampleSort.field}
              sortDirection={sampleSort.direction}
              onToggleSort={toggleSampleSort}
            />
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Decoded JSON</h2>
              <div className="panel-actions">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => copyJsonToClipboard(decodedResponse, "decodedCopy")}
                  disabled={actionStatus.decodedCopy === "loading"}
                >
                  {getCopyButtonLabel(actionStatus.decodedCopy)}
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={openDecodedJsonInNewPage}
                  disabled={actionStatus.decodedOpen !== "idle"}
                >
                  {actionStatus.decodedOpen === "success" ? "Opened!" : "Open Raw JSON"}
                </button>
              </div>
            </div>
            <pre>{JSON.stringify(decodedResponse, null, 2)}</pre>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Raw API Response</h2>
              <div className="panel-actions">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => copyJsonToClipboard(rawResponse, "rawCopy")}
                  disabled={actionStatus.rawCopy === "loading"}
                >
                  {getCopyButtonLabel(actionStatus.rawCopy)}
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={openRawApiJsonInNewPage}
                  disabled={actionStatus.rawOpen !== "idle"}
                >
                  {actionStatus.rawOpen === "success" ? "Opened!" : "Open Raw JSON"}
                </button>
              </div>
            </div>
            <pre>{JSON.stringify(rawResponse, null, 2)}</pre>
          </section>

          <section className="panel">
            <h2>Returned Data</h2>
            <p>
              Hidden rows: {formatInt(decodedResponse.hidden)} | Reported total:{" "}
              {formatInt(decodedResponse.total)} | Min YoE in rows:{" "}
              {computed.minYoe == null ? "N/A" : computed.minYoe} | Max YoE in rows:{" "}
              {computed.maxYoe == null ? "N/A" : computed.maxYoe}
            </p>
          </section>
        </>
      )}
    </main>
  );
}

function BoxPlot({ plot }) {
  if (!plot.hasData) {
    return <p className="warning">No TC data available for plot.</p>;
  }

  return (
    <div className="plot-shell">
      <svg viewBox={`0 0 ${plot.width} ${plot.height}`} preserveAspectRatio="xMidYMid meet">
        {plot.ticks.map((tick) => (
          <g key={`tick-${tick.x}`}>
            <line className="plot-grid" x1={tick.x} y1={plot.marginTop} x2={tick.x} y2={plot.axisY} />
            <text className="plot-tick-label" x={tick.x} y={plot.axisY}>
              {tick.label}
            </text>
          </g>
        ))}

        <line className="plot-axis" x1={plot.minX} y1={plot.axisY} x2={plot.maxX} y2={plot.axisY} />
        <line
          className="plot-whisker"
          x1={plot.minX}
          y1={plot.boxCenterY}
          x2={plot.q1X}
          y2={plot.boxCenterY}
        />
        <line
          className="plot-whisker"
          x1={plot.q3X}
          y1={plot.boxCenterY}
          x2={plot.maxX}
          y2={plot.boxCenterY}
        />
        <line
          className="plot-whisker"
          x1={plot.minX}
          y1={plot.boxTopY}
          x2={plot.minX}
          y2={plot.boxBottomY}
        />
        <line
          className="plot-whisker"
          x1={plot.maxX}
          y1={plot.boxTopY}
          x2={plot.maxX}
          y2={plot.boxBottomY}
        />
        <rect className="plot-box" x={plot.q1X} y={plot.boxTopY} width={plot.boxWidth} height={plot.boxHeight} />
        <line
          className="plot-median"
          x1={plot.medianX}
          y1={plot.boxTopY}
          x2={plot.medianX}
          y2={plot.boxBottomY}
        />

        {plot.dots.map((dot) => (
          <circle key={`${dot.cx}-${dot.cy}`} className="plot-dot" cx={dot.cx} cy={dot.cy} r="10" />
        ))}

        <text className="plot-stat-value" x={plot.q1X} y="36">
          {plot.q1Label}
        </text>
        <text className="plot-stat-value" x={plot.medianX} y="78">
          {plot.medianLabel}
        </text>
        <text className="plot-stat-value" x={plot.q3X} y="36">
          {plot.q3Label}
        </text>

        <text className="plot-stat-label" x={plot.q1X} y="244">
          25th
        </text>
        <text className="plot-stat-label" x={plot.medianX} y="208">
          Med
        </text>
        <text className="plot-stat-label" x={plot.q3X} y="244">
          75th
        </text>
      </svg>
    </div>
  );
}

function SummaryTable({ title, rows }) {
  return (
    <table>
      <thead>
        <tr>
          <th>{title}</th>
          <th>Count</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${title}-${row.value}`}>
            <td>{row.value}</td>
            <td>{row.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SampleRowsTable({ rows, sortField, sortDirection, onToggleSort }) {
  function getSortLabel(field) {
    if (sortField !== field) return "↕";
    return sortDirection === "asc" ? "↑" : "↓";
  }

  return (
    <table>
      <thead>
        <tr>
          <th>
            <button type="button" className="table-sort-button" onClick={() => onToggleSort("company")}>
              Company {getSortLabel("company")}
            </button>
          </th>
          <th>
            <button type="button" className="table-sort-button" onClick={() => onToggleSort("level")}>
              Level {getSortLabel("level")}
            </button>
          </th>
          <th>
            <button type="button" className="table-sort-button" onClick={() => onToggleSort("yoe")}>
              YoE {getSortLabel("yoe")}
            </button>
          </th>
          <th>
            <button type="button" className="table-sort-button" onClick={() => onToggleSort("location")}>
              Location {getSortLabel("location")}
            </button>
          </th>
          <th>
            <button type="button" className="table-sort-button" onClick={() => onToggleSort("offerDateValue")}>
              Offer Date {getSortLabel("offerDateValue")}
            </button>
          </th>
          <th>
            <button
              type="button"
              className="table-sort-button"
              onClick={() => onToggleSort("totalCompensationValue")}
            >
              Total Comp {getSortLabel("totalCompensationValue")}
            </button>
          </th>
          <th>
            <button
              type="button"
              className="table-sort-button"
              onClick={() => onToggleSort("baseSalaryValue")}
            >
              Base {getSortLabel("baseSalaryValue")}
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>{row.company}</td>
            <td>{row.level}</td>
            <td>{Number.isFinite(row.yoe) ? row.yoe : "N/A"}</td>
            <td>{row.location}</td>
            <td>{row.offerDate}</td>
            <td>{row.totalCompensation}</td>
            <td>{row.baseSalary}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

BoxPlot.propTypes = {
  plot: PropTypes.shape({
    hasData: PropTypes.bool.isRequired,
    width: PropTypes.number.isRequired,
    height: PropTypes.number.isRequired,
    marginTop: PropTypes.number,
    axisY: PropTypes.number,
    boxCenterY: PropTypes.number,
    boxTopY: PropTypes.number,
    boxBottomY: PropTypes.number,
    boxHeight: PropTypes.number,
    boxWidth: PropTypes.number,
    minX: PropTypes.number,
    q1X: PropTypes.number,
    medianX: PropTypes.number,
    q3X: PropTypes.number,
    maxX: PropTypes.number,
    q1Label: PropTypes.string,
    medianLabel: PropTypes.string,
    q3Label: PropTypes.string,
    ticks: PropTypes.arrayOf(
      PropTypes.shape({
        x: PropTypes.number.isRequired,
        label: PropTypes.string.isRequired,
      }),
    ),
    dots: PropTypes.arrayOf(
      PropTypes.shape({
        cx: PropTypes.number.isRequired,
        cy: PropTypes.number.isRequired,
      }),
    ),
  }).isRequired,
};

SummaryTable.propTypes = {
  title: PropTypes.string.isRequired,
  rows: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      count: PropTypes.number.isRequired,
    }),
  ).isRequired,
};

SampleRowsTable.propTypes = {
  rows: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      company: PropTypes.string.isRequired,
      level: PropTypes.string.isRequired,
      yoe: PropTypes.number,
      location: PropTypes.string.isRequired,
      offerDate: PropTypes.string.isRequired,
      offerDateValue: PropTypes.number.isRequired,
      totalCompensationValue: PropTypes.number,
      baseSalaryValue: PropTypes.number,
      totalCompensation: PropTypes.string.isRequired,
      baseSalary: PropTypes.string.isRequired,
    }),
  ).isRequired,
  sortField: PropTypes.string.isRequired,
  sortDirection: PropTypes.oneOf(["asc", "desc"]).isRequired,
  onToggleSort: PropTypes.func.isRequired,
};

export default App;

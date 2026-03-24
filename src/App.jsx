import { useMemo, useState } from "react";
import CryptoJS from "crypto-js";
import pako from "pako";
import PropTypes from "prop-types";

const LOCATION_OPTIONS = [
  { label: "Any", value: "" },
  { label: "Austin", value: "635" },
  { label: "NYC", value: "501" },
  { label: "Seattle", value: "819" },
  { label: "SF Bay Area", value: "807" },
];
const COMPANY_OPTIONS = [
  "amazon",
  "apple",
  "bytedance",
  "google",
  "hudson-river-trading",
  "jane-street",
  "meta",
  "microsoft",
];
const LIMIT_OPTIONS = ["50", "100", "150", "200", "250"];
const API_PAGE_LIMIT = 50;
const COMPANY_SERIES_COLORS = [
  "#dc2626",
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#be185d",
  "#4b5563",
];

const STATIC_QUERY_PARAMS = {
  sortBy: "offer_date",
  sortOrder: "DESC",
  jobFamilySlug: "software-engineer",
  currency: "USD",
};

const LEVELS_API_PROXY_PATH = "/api/levels/v3/salary/search";
const LEVELS_API_PROXY_ORIGIN = "https://levelsfyi-proxy.derricken968.workers.dev";
const LEVELS_API_PATH = "/v3/salary/search";

function isLocalhost() {
  const host = globalThis.location.hostname;
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
  const statsByValue = {};
  rows.forEach((row) => {
    const raw = row[field];
    const key = raw == null || raw === "" ? "Unknown" : String(raw);
    const totalCompensationValue = Number(row.totalCompensation);
    if (!statsByValue[key]) {
      statsByValue[key] = {
        count: 0,
        totalCompensationSum: 0,
      };
    }
    statsByValue[key].count += 1;
    if (Number.isFinite(totalCompensationValue)) {
      statsByValue[key].totalCompensationSum += totalCompensationValue;
    }
  });

  return Object.entries(statsByValue)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([value, stats]) => ({
      value,
      count: stats.count,
      avgTCValue: stats.count ? stats.totalCompensationSum / stats.count : Number.NaN,
    }));
}

function buildRequestUrl(formState, company, offset = 0) {
  const companySlug = company
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, "-");
  const params = new URLSearchParams({
    minYearsOfExp: String(formState.minYearsOfExp),
    maxYearsOfExp: String(formState.maxYearsOfExp),
    companySlug,
    limit: String(API_PAGE_LIMIT),
    offset: String(offset),
    ...STATIC_QUERY_PARAMS,
  });
  if (formState.dmaId) {
    params.append("dmaIds[]", formState.dmaId);
  }
  const searchText = formState.locationSearchText.trim();
  if (searchText) {
    params.append("searchText", searchText);
  }
  const url = isLocalhost()
    ? new URL(LEVELS_API_PROXY_PATH, globalThis.location.origin)
    : new URL(LEVELS_API_PATH, LEVELS_API_PROXY_ORIGIN);
  url.search = params.toString();
  return url.toString();
}

function mergeDecodedPages(decodedPages, rowLimit) {
  if (!decodedPages.length) {
    return { rows: [] };
  }

  const mergedRows = decodedPages.flatMap((page) => (Array.isArray(page.rows) ? page.rows : []));
  return {
    ...decodedPages[0],
    rows: mergedRows.slice(0, rowLimit),
  };
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

function hexToRgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return `rgba(0, 0, 0, ${alpha})`;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getCompanySeriesColor(index) {
  return COMPANY_SERIES_COLORS[index % COMPANY_SERIES_COLORS.length];
}

function buildMultiTcDistributionPlot(companyResults) {
  const sortedSeriesInput = companyResults.map((companyResult) => ({
    label: companyResult.companySlug,
    values: [...companyResult.metrics.tcValues].sort((a, b) => a - b),
  }));
  const mergedValues = sortedSeriesInput.flatMap((series) => series.values).sort((a, b) => a - b);

  const width = 860;
  const rowHeight = 108;
  const minHeight = 390;
  const height = Math.max(minHeight, 120 + sortedSeriesInput.length * rowHeight);
  const marginLeft = 58;
  const marginRight = 38;
  const marginTop = 34;
  const plotWidth = width - marginLeft - marginRight;

  if (!mergedValues.length) {
    return { width, height, hasData: false };
  }

  const min = mergedValues[0];
  const max = mergedValues.at(-1);
  const rawRange = Math.max(max - min, 1);
  const domainPadding = Math.max(rawRange * 0.12, 8000);
  const domainMin = Math.max(0, min - domainPadding);
  const domainMax = max + domainPadding;
  const domainRange = Math.max(domainMax - domainMin, 1);

  function xScale(v) {
    return marginLeft + ((v - domainMin) / domainRange) * plotWidth;
  }

  function buildSeries(values, color, centerY) {
    if (!values.length) {
      return {
        color,
        centerY,
        hasData: false,
        dots: [],
      };
    }
    const q1 = percentile(values, 0.25);
    const median = percentile(values, 0.5);
    const q3 = percentile(values, 0.75);
    const boxHeight = 56;
    const boxTopY = centerY - boxHeight / 2;
    const boxBottomY = centerY + boxHeight / 2;
    const dotOffsets = [-22, -10, 0, 10, 22, -16, 16];

    return {
      color,
      centerY,
      hasData: true,
      minX: xScale(values[0]),
      q1X: xScale(q1),
      medianX: xScale(median),
      q3X: xScale(q3),
      maxX: xScale(values.at(-1)),
      boxWidth: Math.max(xScale(q3) - xScale(q1), 1),
      boxHeight,
      boxTopY,
      boxBottomY,
      q1Label: formatUSDCompact(q1),
      medianLabel: formatUSDCompact(median),
      q3Label: formatUSDCompact(q3),
      dots: values.map((value, index) => ({
        cx: xScale(value),
        cy: centerY + dotOffsets[index % dotOffsets.length],
      })),
    };
  }

  const axisY = height - 66;
  const series = sortedSeriesInput.map((seriesInput, index) => {
    const color = getCompanySeriesColor(index);
    const centerY = 124 + index * rowHeight;
    return {
      ...buildSeries(seriesInput.values, color, centerY),
      label: seriesInput.label,
    };
  });
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
    axisY,
    ticks,
    series,
    axisStartX: marginLeft,
    axisEndX: width - marginRight,
  };
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

function getCopyButtonLabel(status) {
  if (status === "loading") return "Copying...";
  if (status === "success") return "Copied!";
  return "Copy JSON";
}

function computeCompanyMetrics(decodedResponse) {
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
    tcValues,
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
    plot: buildTcDistributionPlot(tcValues),
    total: decodedResponse.total,
  };
}

async function fetchCompanyResult(formState, bearerToken, selectedLimit, companySlug) {
  const decodedPages = [];
  let offset = 0;
  let fetchedRows = 0;

  while (fetchedRows < selectedLimit) {
    const url = buildRequestUrl(formState, companySlug, offset);
    const response = await fetch(url, { headers: buildHeaders(bearerToken) });
    if (!response.ok) {
      throw new Error(`Request failed for ${companySlug} with status ${response.status}.`);
    }

    const responseJson = await response.json();
    const decoded = decodeLevelsPayload(responseJson);
    const pageRows = Array.isArray(decoded.rows) ? decoded.rows : [];
    const reportedTotal = Number(decoded.total);

    decodedPages.push(decoded);
    fetchedRows += pageRows.length;

    const reachedSelectedLimit = fetchedRows >= selectedLimit;
    const reachedEndOfResults = pageRows.length < API_PAGE_LIMIT;
    const reachedReportedTotal = Number.isFinite(reportedTotal) && offset + pageRows.length >= reportedTotal;
    if (reachedSelectedLimit || reachedEndOfResults || reachedReportedTotal) {
      break;
    }

    offset += API_PAGE_LIMIT;
  }

  const mergedDecodedResponse = mergeDecodedPages(decodedPages, selectedLimit);
  return {
    companySlug,
    metrics: computeCompanyMetrics(mergedDecodedResponse),
    rawResponse: decodedPages.length === 1 ? decodedPages[0] : decodedPages,
    decodedResponse: mergedDecodedResponse,
  };
}

function App() {
  const [formState, setFormState] = useState({
    bearerToken: "",
    companies: [{ id: "company-google", value: "google" }],
    minYearsOfExp: "2",
    maxYearsOfExp: "4",
    dmaId: "807",
    locationSearchText: "",
    limit: "50",
  });
  const [companyResults, setCompanyResults] = useState([]);
  const [requestError, setRequestError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState({
    decodedCopy: "idle",
    decodedOpen: "idle",
    rawCopy: "idle",
    rawOpen: "idle",
  });
  const [sampleSort, setSampleSort] = useState({
    field: "",
    direction: "desc",
  });

  const isSingleCompanyResult = companyResults.length === 1;
  const hasMultipleCompanyResults = companyResults.length > 1;
  const singleCompanyResult = isSingleCompanyResult ? companyResults[0] : null;
  const mergedMultiCompanyPlot = useMemo(() => {
    if (!hasMultipleCompanyResults) return null;
    return buildMultiTcDistributionPlot(companyResults);
  }, [companyResults, hasMultipleCompanyResults]);

  const sortedSampleRows = useMemo(() => {
    if (!singleCompanyResult) return [];
    const rows = buildSampleRows(singleCompanyResult.metrics.rows);
    if (!sampleSort.field) return rows;
    rows.sort((a, b) => compareValues(a[sampleSort.field], b[sampleSort.field], sampleSort.direction));
    return rows;
  }, [singleCompanyResult, sampleSort]);

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

  function setTransientActionStatus(key, value) {
    setActionStatus((prev) => ({ ...prev, [key]: value }));
    globalThis.setTimeout(() => {
      setActionStatus((prev) => ({ ...prev, [key]: "idle" }));
    }, 1200);
  }

  function updateCompany(index, value) {
    setFormState((prev) => ({
      ...prev,
      companies: prev.companies.map((company, companyIndex) =>
        companyIndex === index ? { ...company, value } : company,
      ),
    }));
  }

  function addCompany() {
    const companyId = `company-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setFormState((prev) => ({
      ...prev,
      companies: [...prev.companies, { id: companyId, value: "" }],
    }));
  }

  function removeCompany(index) {
    setFormState((prev) => {
      if (prev.companies.length <= 1) {
        return prev;
      }
      return {
        ...prev,
        companies: prev.companies.filter((_, companyIndex) => companyIndex !== index),
      };
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setRequestError("");
    setIsLoading(true);
    setCompanyResults([]);

    try {
      const bearerToken = formState.bearerToken.trim();
      if (!bearerToken) {
        throw new Error("Bearer token is required.");
      }

      const selectedLimit = Number(formState.limit);
      const companySlugs = formState.companies
        .map((company) => company.value.trim().toLowerCase().replaceAll(/\s+/g, "-"))
        .filter(Boolean);
      if (!companySlugs.length) {
        throw new Error("At least one company is required.");
      }

      const nextCompanyResults = [];
      for (const companySlug of companySlugs) {
        const companyResult = await fetchCompanyResult(
          formState,
          bearerToken,
          selectedLimit,
          companySlug,
        );
        nextCompanyResults.push(companyResult);
      }

      setCompanyResults(nextCompanyResults);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Unexpected request error.");
    } finally {
      setIsLoading(false);
    }
  }

  function openDecodedJsonInNewPage() {
    if (!singleCompanyResult?.decodedResponse) return;
    const jsonText = JSON.stringify(singleCompanyResult.decodedResponse, null, 2);
    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setTransientActionStatus("decodedOpen", "success");
  }

  function openRawApiJsonInNewPage() {
    if (!singleCompanyResult?.rawResponse) return;
    const jsonText = JSON.stringify(singleCompanyResult.rawResponse, null, 2);
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
        <p>Select how many recent records to fetch (loaded in pages of 50).</p>
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
          <div className="company-list-field">
            <span>Companies</span>
            {formState.companies.map((company, index) => (
              <div key={company.id} className="company-row">
                <input
                  list="company-options"
                  value={company.value}
                  onChange={(event) => updateCompany(index, event.target.value)}
                  required
                />
                <button
                  type="button"
                  className="company-row-action"
                  onClick={() => removeCompany(index)}
                  disabled={formState.companies.length <= 1}
                >
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="company-row-action" onClick={addCompany}>
              Add Company
            </button>
            <datalist id="company-options">
              {COMPANY_OPTIONS.map((company) => (
                <option key={company} value={company} />
              ))}
            </datalist>
          </div>
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
          <label>
            <span>Location Search</span>
            <input
              type="text"
              value={formState.locationSearchText}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, locationSearchText: event.target.value }))
              }
              placeholder="e.g. San Jose"
            />
          </label>
          <label>
            <span>Limit</span>
            <select
              value={formState.limit}
              onChange={(event) => setFormState((prev) => ({ ...prev, limit: event.target.value }))}
            >
              {LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
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

      {hasMultipleCompanyResults && mergedMultiCompanyPlot && (
        <section className="panel">
          <h2>TC Distribution (Combined)</h2>
          <MultiCompanyBoxPlot plot={mergedMultiCompanyPlot} />
        </section>
      )}

      {companyResults.length > 0 &&
        companyResults.map((result, resultIndex) => (
        <section
          key={`${result.companySlug}-${result.metrics.total}-${result.metrics.count}`}
          className="company-results-group"
          style={{ "--company-color": getCompanySeriesColor(resultIndex) }}
        >
          <section className="panel">
            <h2>{result.companySlug}</h2>
          </section>
          <section className="grid metrics">
            <article className="panel metric">
              <h2>Average TC</h2>
              <div>{formatUSD(result.metrics.avgTC)}</div>
            </article>
            <article className="panel metric">
              <h2>Q1</h2>
              <div>{formatUSD(result.metrics.q1)}</div>
            </article>
            <article className="panel metric">
              <h2>Median</h2>
              <div>{formatUSD(result.metrics.median)}</div>
            </article>
            <article className="panel metric">
              <h2>Q3</h2>
              <div>{formatUSD(result.metrics.q3)}</div>
            </article>
            <article className="panel metric">
              <h2>Min / Max TC</h2>
              <div>
                {formatUSD(result.metrics.minTC)} / {formatUSD(result.metrics.maxTC)}
              </div>
            </article>
            <article className="panel metric">
              <h2>Rows Used</h2>
              <div>{formatInt(result.metrics.count)}</div>
            </article>
            <article className="panel metric">
              <h2>Response Total</h2>
              <div>{formatInt(result.metrics.total)}</div>
            </article>
          </section>

          {!hasMultipleCompanyResults && (
            <section className="panel">
              <h2>TC Distribution</h2>
              <BoxPlot plot={result.metrics.plot} />
            </section>
          )}

          <section className="grid">
            <article className="panel">
              <h2>Top Levels</h2>
              <SummaryTable title="Level" rows={result.metrics.levelSummary} />
            </article>
            <article className="panel">
              <h2>Top Locations</h2>
              <SummaryTable title="Location" rows={result.metrics.locationSummary} />
            </article>
            <article className="panel">
              <h2>Top Gender</h2>
              <SummaryTable title="Gender" rows={result.metrics.genderSummary} />
            </article>
            <article className="panel">
              <h2>Top Ethnicity</h2>
              <SummaryTable title="Ethnicity" rows={result.metrics.ethnicitySummary} />
            </article>
          </section>

          {isSingleCompanyResult && (
            <>
              <section className="panel">
                <h2>Records</h2>
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
                      onClick={() => copyJsonToClipboard(singleCompanyResult.decodedResponse, "decodedCopy")}
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
                <pre>{JSON.stringify(singleCompanyResult.decodedResponse, null, 2)}</pre>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <h2>Raw API Response</h2>
                  <div className="panel-actions">
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => copyJsonToClipboard(singleCompanyResult.rawResponse, "rawCopy")}
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
                <pre>{JSON.stringify(singleCompanyResult.rawResponse, null, 2)}</pre>
              </section>

              <section className="panel">
                <h2>Returned Data</h2>
                <p>
                  Hidden rows: {formatInt(singleCompanyResult.decodedResponse.hidden)} | Reported total:{" "}
                  {formatInt(singleCompanyResult.decodedResponse.total)} | Min YoE in rows:{" "}
                  {singleCompanyResult.metrics.minYoe == null ? "N/A" : singleCompanyResult.metrics.minYoe} |
                  Max YoE in rows:{" "}
                  {singleCompanyResult.metrics.maxYoe == null ? "N/A" : singleCompanyResult.metrics.maxYoe}
                </p>
              </section>
            </>
          )}
        </section>
      ))}
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

function MultiCompanyBoxPlot({ plot }) {
  if (!plot.hasData) {
    return <p className="warning">No TC data available for plot.</p>;
  }

  return (
    <div className="plot-shell">
      <svg viewBox={`0 0 ${plot.width} ${plot.height}`} preserveAspectRatio="xMidYMid meet">
        {plot.ticks.map((tick) => (
          <g key={`dual-tick-${tick.x}`}>
            <line className="plot-grid" x1={tick.x} y1={plot.marginTop} x2={tick.x} y2={plot.axisY} />
            <text className="plot-tick-label" x={tick.x} y={plot.axisY}>
              {tick.label}
            </text>
          </g>
        ))}

        {plot.series.map((series) => (
          <g key={`series-${series.label}`}>
            <text className="plot-series-label" x="18" y={series.centerY + 4} style={{ fill: series.color }}>
              {series.label}
            </text>
            {series.hasData && (
              <>
                <line
                  className="plot-whisker"
                  style={{ stroke: series.color }}
                  x1={series.minX}
                  y1={series.centerY}
                  x2={series.q1X}
                  y2={series.centerY}
                />
                <line
                  className="plot-whisker"
                  style={{ stroke: series.color }}
                  x1={series.q3X}
                  y1={series.centerY}
                  x2={series.maxX}
                  y2={series.centerY}
                />
                <line
                  className="plot-whisker"
                  style={{ stroke: series.color }}
                  x1={series.minX}
                  y1={series.boxTopY}
                  x2={series.minX}
                  y2={series.boxBottomY}
                />
                <line
                  className="plot-whisker"
                  style={{ stroke: series.color }}
                  x1={series.maxX}
                  y1={series.boxTopY}
                  x2={series.maxX}
                  y2={series.boxBottomY}
                />
                <rect
                  className="plot-box"
                  style={{ fill: hexToRgba(series.color, 0.14), stroke: series.color }}
                  x={series.q1X}
                  y={series.boxTopY}
                  width={series.boxWidth}
                  height={series.boxHeight}
                />
                <line
                  className="plot-median"
                  style={{ stroke: series.color }}
                  x1={series.medianX}
                  y1={series.boxTopY}
                  x2={series.medianX}
                  y2={series.boxBottomY}
                />

                {series.dots.map((dot, index) => (
                  <circle
                    key={`${series.label}-${dot.cx}-${dot.cy}-${index}`}
                    className="plot-dot"
                    style={{ fill: hexToRgba(series.color, 0.85) }}
                    cx={dot.cx}
                    cy={dot.cy}
                    r="7"
                  />
                ))}

                <text className="plot-stat-value" x={series.q1X} y={series.boxTopY - 10}>
                  {series.q1Label}
                </text>
                <text className="plot-stat-value" x={series.medianX} y={series.centerY + 6}>
                  {series.medianLabel}
                </text>
                <text className="plot-stat-value" x={series.q3X} y={series.boxTopY - 10}>
                  {series.q3Label}
                </text>
              </>
            )}
          </g>
        ))}

        <line className="plot-axis" x1={plot.axisStartX} y1={plot.axisY} x2={plot.axisEndX} y2={plot.axisY} />
      </svg>
    </div>
  );
}

function SummaryTable({ title, rows }) {
  const [sort, setSort] = useState({
    field: "",
    direction: "desc",
  });

  const sortedRows = useMemo(() => {
    const nextRows = [...rows];
    if (!sort.field) return nextRows;
    nextRows.sort((a, b) => compareValues(a[sort.field], b[sort.field], sort.direction));
    return nextRows;
  }, [rows, sort]);

  function toggleSort(field) {
    setSort((prev) => {
      if (prev.field === field) {
        return {
          field,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      return {
        field,
        direction: "desc",
      };
    });
  }

  function getSortLabel(field) {
    if (sort.field !== field) return "↕";
    return sort.direction === "asc" ? "↑" : "↓";
  }

  return (
    <table>
      <thead>
        <tr>
          <th>
            <button type="button" className="table-sort-button" onClick={() => toggleSort("value")}>
              {title} {getSortLabel("value")}
            </button>
          </th>
          <th>
            <button type="button" className="table-sort-button" onClick={() => toggleSort("count")}>
              Count {getSortLabel("count")}
            </button>
          </th>
          <th>
            <button type="button" className="table-sort-button" onClick={() => toggleSort("avgTCValue")}>
              Avg TC {getSortLabel("avgTCValue")}
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row) => (
          <tr key={`${title}-${row.value}`}>
            <td>{row.value}</td>
            <td>{row.count}</td>
            <td>{formatUSD(row.avgTCValue)}</td>
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

MultiCompanyBoxPlot.propTypes = {
  plot: PropTypes.shape({
    hasData: PropTypes.bool.isRequired,
    width: PropTypes.number.isRequired,
    height: PropTypes.number.isRequired,
    marginTop: PropTypes.number,
    axisY: PropTypes.number,
    ticks: PropTypes.arrayOf(
      PropTypes.shape({
        x: PropTypes.number.isRequired,
        label: PropTypes.string.isRequired,
      }),
    ),
    series: PropTypes.arrayOf(
      PropTypes.shape({
        label: PropTypes.string.isRequired,
        color: PropTypes.string.isRequired,
        centerY: PropTypes.number.isRequired,
        hasData: PropTypes.bool.isRequired,
        minX: PropTypes.number,
        q1X: PropTypes.number,
        medianX: PropTypes.number,
        q3X: PropTypes.number,
        maxX: PropTypes.number,
        boxWidth: PropTypes.number,
        boxHeight: PropTypes.number,
        boxTopY: PropTypes.number,
        boxBottomY: PropTypes.number,
        q1Label: PropTypes.string,
        medianLabel: PropTypes.string,
        q3Label: PropTypes.string,
        dots: PropTypes.arrayOf(
          PropTypes.shape({
            cx: PropTypes.number.isRequired,
            cy: PropTypes.number.isRequired,
          }),
        ).isRequired,
      }),
    ).isRequired,
    axisStartX: PropTypes.number.isRequired,
    axisEndX: PropTypes.number.isRequired,
  }).isRequired,
};

SummaryTable.propTypes = {
  title: PropTypes.string.isRequired,
  rows: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      count: PropTypes.number.isRequired,
      avgTCValue: PropTypes.number,
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

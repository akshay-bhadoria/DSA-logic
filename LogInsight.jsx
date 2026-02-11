import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Search,
  Copy,
  Download,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Info,
  Terminal,
  Activity,
  Bell,
  Bug,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
} from "lucide-react";

// ─── Configuration ───────────────────────────────────────────────────────────
const API_ENDPOINT = "/api/v1/ai/completions";
const API_KEY = "YOUR_API_KEY_HERE";
const USE_MOCK = true;
const MAX_TOKENS = 2000;
const CHAR_SOFT_LIMIT = 15000;
const MAX_HISTORY = 5;

// ─── Input Types ─────────────────────────────────────────────────────────────
const INPUT_TYPES = [
  { id: "stacktrace", label: "Stack Trace", icon: Terminal },
  { id: "splunk", label: "Splunk Logs", icon: Search },
  { id: "datadog", label: "Datadog Alert", icon: Bell },
  { id: "general", label: "General Debug", icon: Bug },
];

const SERVICES = [
  "positions-api",
  "balances-api",
  "orders-api",
  "gateway-service",
  "auth-service",
];

const ENVIRONMENTS = ["PROD", "UAT", "SIT"];

const PLACEHOLDERS = {
  stacktrace: "Paste your Java stack trace here...",
  splunk: "Paste Splunk log output here (JSON or raw text)...",
  datadog: "Paste the Datadog alert payload or description...",
  general: "Describe the issue or paste any relevant output...",
};

// ─── Prompt Templates ────────────────────────────────────────────────────────
function buildPrompt(inputType, context, content) {
  const { serviceName, environment, correlationId } = context;
  const corrIdClause = correlationId
    ? ` Correlation ID: ${correlationId}.`
    : "";

  const prompts = {
    stacktrace: `You are a senior Java engineer at a financial services company analyzing production issues. The stack trace is from a ${serviceName} service running in ${environment}.${corrIdClause} Analyze the following stack trace and provide: 1) A one-line summary 2) Root cause analysis 3) Affected services and blast radius 4) Severity (Critical/High/Medium/Low) 5) Suggested fix with specific code or config changes 6) Similar known patterns to check. Be specific to Java/Spring Boot APIs handling financial data (positions, balances, orders).\n\nStack trace:\n${content}`,

    splunk: `You are a senior SRE at a financial services company analyzing Splunk log output. The logs are from the ${serviceName} service in ${environment}.${corrIdClause} Analyze the following Splunk logs and provide: 1) A one-line summary of what happened 2) Root cause — identify the error pattern, failing component, or anomalous behavior 3) Affected services — which upstream/downstream services are impacted 4) Severity (Critical/High/Medium/Low) based on customer impact and data integrity risk 5) Suggested fix — specific remediation steps including config changes, restarts, or code fixes 6) Related patterns — similar log signatures or known issues to investigate. Focus on financial transaction flows (positions, balances, orders).\n\nSplunk logs:\n${content}`,

    datadog: `You are a senior SRE at a financial services company triaging a Datadog alert. The alert is from the ${serviceName} service in ${environment}.${corrIdClause} Analyze the following Datadog alert and provide: 1) A one-line summary of the alert 2) Root cause — what is likely triggering this alert (latency spike, error rate, resource exhaustion, etc.) 3) Affected services — blast radius and downstream impact 4) Severity (Critical/High/Medium/Low) based on SLA impact and customer-facing risk 5) Suggested fix — immediate mitigation steps and longer-term fixes 6) Related patterns — correlated monitors, recent deployments, or known issues to check. Context: financial APIs handling real-time positions, balances, and order execution.\n\nDatadog alert:\n${content}`,

    general: `You are a senior Java/Spring Boot engineer at a financial services company helping debug an issue. The issue involves the ${serviceName} service in ${environment}.${corrIdClause} Analyze the following debug information and provide: 1) A one-line summary 2) Root cause analysis — what is most likely going wrong 3) Affected services — which components may be impacted 4) Severity (Critical/High/Medium/Low) 5) Suggested fix — actionable steps to resolve 6) Related patterns — similar issues or areas to investigate. Be specific to Java microservices handling financial data.\n\nDebug info:\n${content}`,
  };

  return prompts[inputType] || prompts.general;
}

// ─── Mock Response ───────────────────────────────────────────────────────────
function getMockResponse(inputType, context) {
  const mockResponses = {
    stacktrace: {
      summary:
        "NullPointerException in PositionAggregator when processing margin calculation for accounts with zero holdings.",
      rootCause:
        'The PositionAggregator.calculateMargin() method at line 247 attempts to call getHoldings().stream() on a null portfolio object. This occurs when an account exists in the auth system but has no initialized portfolio in the positions database. The upstream AccountResolver returns a valid account wrapper but with a null inner portfolio reference, which is not checked before the stream operation. This is a data initialization race condition — the account was created in auth-service but the async portfolio provisioning in positions-api has not yet completed.',
      affectedServices: [
        `${context.serviceName} — primary failure point`,
        "balances-api — downstream balance calculations will return stale data",
        "gateway-service — API responses will return 500 to clients",
        "orders-api — order placement may fail for affected accounts if position checks are required",
      ],
      severity: "High",
      suggestedFix:
        '1. **Immediate**: Add null-check in PositionAggregator.java line 245:\n```java\nif (account.getPortfolio() == null) {\n    log.warn("Portfolio not initialized for account {}", account.getId());\n    return MarginResult.empty();\n}\n```\n2. **Short-term**: Add a portfolio initialization check in the AccountResolver before returning:\n```java\nObjects.requireNonNull(account.getPortfolio(), \n    "Portfolio not provisioned for account: " + account.getId());\n```\n3. **Long-term**: Make portfolio provisioning synchronous during account creation, or add a retry mechanism with backoff in the positions-api consumer.',
      relatedPatterns: [
        "Check for similar NPEs in BalanceCalculator — it uses the same AccountResolver",
        "Review recent deployments to auth-service that may have changed account creation flow",
        "Search Splunk for 'Portfolio not initialized' warnings — may indicate broader provisioning delays",
        "Check if the async portfolio provisioning Kafka consumer has lag in the affected environment",
      ],
    },
    splunk: {
      summary:
        "Elevated 503 error rate from gateway-service with connection pool exhaustion to downstream balances-api.",
      rootCause:
        "The Splunk logs show a pattern of connection timeout errors originating from the HikariCP connection pool in gateway-service. The pool is configured with a maximum of 10 connections and a 30s timeout, but balances-api response times have degraded to 45-60s, causing all connections to be held. This creates a cascading failure where new requests cannot acquire connections and return 503. The balances-api slowdown correlates with a spike in database query times, likely due to a missing index on the account_positions table for the new margin query added in last week's release.",
      affectedServices: [
        "gateway-service — returning 503 to all downstream consumers",
        "balances-api — source of the latency degradation",
        "positions-api — margin queries contributing to DB load",
        "All client-facing applications routing through gateway-service",
      ],
      severity: "Critical",
      suggestedFix:
        "1. **Immediate**: Increase HikariCP pool size and timeout in gateway-service:\n```yaml\nspring.datasource.hikari.maximum-pool-size: 25\nspring.datasource.hikari.connection-timeout: 60000\n```\n2. **Root fix**: Add missing database index:\n```sql\nCREATE INDEX idx_account_positions_margin \nON account_positions (account_id, position_type, settlement_date);\n```\n3. **Monitoring**: Add a Datadog monitor for HikariCP active connections > 80% pool size.",
      relatedPatterns: [
        "Check for similar connection pool exhaustion in other services using HikariCP",
        "Review the margin query execution plan in balances-api",
        "Look for correlated Datadog alerts on database CPU/IO metrics",
        "Verify the same index exists in UAT and SIT environments",
      ],
    },
    datadog: {
      summary:
        "P99 latency breach on orders-api /v2/orders endpoint exceeding 5s SLA threshold.",
      rootCause:
        "The Datadog alert indicates the P99 latency for the /v2/orders endpoint has exceeded the 5-second SLA threshold, currently at 8.2s. The latency spike correlates with a 40% increase in order volume during market open, combined with synchronous position validation calls to positions-api that are themselves experiencing elevated latency. The orders-api is making blocking HTTP calls to positions-api for real-time position checks before order execution, and positions-api is under load from the concurrent margin calculation batch job that runs at market open.",
      affectedServices: [
        "orders-api — primary SLA breach",
        "positions-api — upstream dependency causing the bottleneck",
        "Client trading platforms — users experiencing slow order placement",
        "Compliance reporting — delayed order confirmations",
      ],
      severity: "Critical",
      suggestedFix:
        "1. **Immediate**: Reschedule the margin calculation batch job to run 30 minutes before market open:\n```yaml\nscheduler.margin-calc.cron: 0 0 9 * * MON-FRI  # was 0 30 9\n```\n2. **Short-term**: Add circuit breaker to the positions-api call in orders-api:\n```java\n@CircuitBreaker(name = \"positionsApi\", fallbackMethod = \"fallbackPositionCheck\")\npublic PositionValidation validatePosition(OrderRequest order) { ... }\n```\n3. **Long-term**: Make position validation asynchronous using a cached position snapshot updated every 30s.",
      relatedPatterns: [
        "Check if the same latency pattern occurs at market close",
        "Review positions-api thread pool configuration for concurrent request handling",
        "Look for correlated CPU alerts on the positions-api hosts",
        "Verify connection pool settings between orders-api and positions-api",
      ],
    },
    general: {
      summary:
        "Intermittent authentication failures for service-to-service calls between orders-api and positions-api.",
      rootCause:
        "The issue appears to be caused by JWT token expiration during long-running position validation requests. The orders-api obtains a service token with a 60-second TTL from auth-service, but under high load, the positions-api call can exceed this window. When the token expires mid-request, the positions-api returns a 401, which orders-api does not retry with a refreshed token. The current token refresh logic only triggers on initial request setup, not on 401 responses from downstream services.",
      affectedServices: [
        "orders-api — experiencing intermittent 401 errors",
        "positions-api — rejecting valid service calls due to expired tokens",
        "auth-service — may see increased token refresh requests after fix",
      ],
      severity: "Medium",
      suggestedFix:
        "1. **Immediate**: Increase service token TTL in auth-service configuration:\n```yaml\nauth.service-token.ttl-seconds: 300  # was 60\n```\n2. **Better fix**: Add token refresh on 401 retry in the service client:\n```java\npublic class ServiceTokenInterceptor implements ClientHttpRequestInterceptor {\n    @Override\n    public ClientHttpResponse intercept(...) {\n        response = execution.execute(request, body);\n        if (response.getStatusCode() == HttpStatus.UNAUTHORIZED) {\n            tokenProvider.refreshToken();\n            request.getHeaders().setBearerAuth(tokenProvider.getToken());\n            return execution.execute(request, body);\n        }\n        return response;\n    }\n}\n```\n3. **Long-term**: Implement token pre-refresh when TTL is within 20% of expiry.",
      relatedPatterns: [
        "Check if balances-api has the same token refresh issue",
        "Review auth-service logs for token refresh rate spikes",
        "Look for 401 error patterns in Splunk during peak hours",
        "Verify that the token cache in gateway-service handles concurrent refresh correctly",
      ],
    },
  };

  return mockResponses[inputType] || mockResponses.general;
}

// ─── AI Gateway Call ─────────────────────────────────────────────────────────
async function analyzeWithAI(inputType, context, logContent) {
  const prompt = buildPrompt(inputType, context, logContent);

  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 1800));
    return getMockResponse(inputType, context);
  }

  try {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ prompt, max_tokens: MAX_TOKENS }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return parseAIResponse(data);
  } catch (err) {
    console.error("AI Gateway error, falling back to mock:", err);
    return getMockResponse(inputType, context);
  }
}

function parseAIResponse(data) {
  const text = data?.choices?.[0]?.text || data?.completion || "";
  return {
    summary: extractSection(text, "summary") || text.slice(0, 120),
    rootCause: extractSection(text, "root cause") || "Unable to parse root cause.",
    affectedServices: extractListSection(text, "affected services"),
    severity: extractSeverity(text),
    suggestedFix: extractSection(text, "suggested fix") || "See full analysis.",
    relatedPatterns: extractListSection(text, "related patterns"),
  };
}

function extractSection(text, sectionName) {
  const regex = new RegExp(
    `(?:#{1,3}\\s*)?(?:\\d+[.)\\s]*)?${sectionName}[:\\s]*(.+?)(?=(?:#{1,3}\\s*)?(?:\\d+[.)\\s]*)?(summary|root cause|affected|severity|suggested|related|$))`,
    "is"
  );
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function extractListSection(text, sectionName) {
  const section = extractSection(text, sectionName);
  if (!section) return ["No data available"];
  return section
    .split(/[\n•\-]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractSeverity(text) {
  if (/critical/i.test(text)) return "Critical";
  if (/high/i.test(text)) return "High";
  if (/medium/i.test(text)) return "Medium";
  return "Low";
}

// ─── Severity Badge ──────────────────────────────────────────────────────────
function SeverityBadge({ severity }) {
  const colors = {
    Critical: "bg-red-500/20 text-red-400 border-red-500/30",
    High: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    Medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    Low: "bg-green-500/20 text-green-400 border-green-500/30",
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors[severity] || colors.Low}`}
    >
      {severity}
    </span>
  );
}

// ─── Collapsible Section ─────────────────────────────────────────────────────
function CollapsibleSection({ title, icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-700/50 rounded-lg mb-3 overflow-hidden transition-all duration-200">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-gray-800/50 hover:bg-gray-700/50 transition-colors text-left"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
        <span className="text-gray-400 flex-shrink-0">{icon}</span>
        <span className="text-sm font-medium text-gray-200">{title}</span>
      </button>
      <div
        className={`transition-all duration-200 ${open ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0 overflow-hidden"}`}
      >
        <div className="px-4 py-3 text-sm text-gray-300 leading-relaxed">
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton Loader ─────────────────────────────────────────────────────────
function SkeletonLoader() {
  return (
    <div className="animate-pulse space-y-4 p-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-4 bg-gray-700/50 rounded w-1/3" />
          <div className="h-3 bg-gray-700/30 rounded w-full" />
          <div className="h-3 bg-gray-700/30 rounded w-5/6" />
          {i < 6 && <div className="h-px bg-gray-800 mt-3" />}
        </div>
      ))}
    </div>
  );
}

// ─── Code Block Renderer ─────────────────────────────────────────────────────
function RenderContent({ text }) {
  if (!text) return null;

  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const code = part.replace(/```\w*\n?/, "").replace(/\n?```$/, "");
          return (
            <pre
              key={i}
              className="bg-gray-900/80 border border-gray-700/50 rounded-md p-3 my-2 overflow-x-auto font-mono text-xs text-green-400 leading-relaxed"
            >
              {code}
            </pre>
          );
        }
        const lines = part.split("\n");
        return (
          <span key={i}>
            {lines.map((line, j) => {
              const boldReplaced = line.replace(
                /\*\*(.+?)\*\*/g,
                (_, m) => m
              );
              return (
                <span key={j}>
                  {boldReplaced}
                  {j < lines.length - 1 && <br />}
                </span>
              );
            })}
          </span>
        );
      })}
    </>
  );
}

// ─── Analysis Output ─────────────────────────────────────────────────────────
function AnalysisOutput({ result }) {
  if (!result) return null;
  return (
    <div className="space-y-1">
      <CollapsibleSection title="Summary" icon="#" defaultOpen={true}>
        <p className="text-gray-100 font-medium">{result.summary}</p>
      </CollapsibleSection>

      <CollapsibleSection title="Root Cause" icon="!" defaultOpen={true}>
        <RenderContent text={result.rootCause} />
      </CollapsibleSection>

      <CollapsibleSection
        title="Affected Services"
        icon="~"
        defaultOpen={true}
      >
        <ul className="space-y-1.5">
          {result.affectedServices.map((svc, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-green-500 mt-0.5">&#x25B8;</span>
              <span>{svc}</span>
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection
        title="Severity Assessment"
        icon="^"
        defaultOpen={true}
      >
        <div className="flex items-center gap-3">
          <SeverityBadge severity={result.severity} />
          <span className="text-gray-400 text-xs">
            Based on blast radius and customer impact analysis
          </span>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Suggested Fix" icon=">" defaultOpen={true}>
        <RenderContent text={result.suggestedFix} />
      </CollapsibleSection>

      <CollapsibleSection
        title="Related Patterns"
        icon="?"
        defaultOpen={false}
      >
        <ul className="space-y-1.5">
          {result.relatedPatterns.map((pat, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-yellow-500 mt-0.5">&#x25B8;</span>
              <span>{pat}</span>
            </li>
          ))}
        </ul>
      </CollapsibleSection>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function LogInsight() {
  const [inputType, setInputType] = useState("stacktrace");
  const [serviceName, setServiceName] = useState("positions-api");
  const [customService, setCustomService] = useState("");
  const [environment, setEnvironment] = useState("PROD");
  const [correlationId, setCorrelationId] = useState("");
  const [logContent, setLogContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const textareaRef = useRef(null);

  const effectiveService =
    serviceName === "__custom" ? customService : serviceName;

  // Keyboard shortcut: Cmd/Ctrl + Enter
  useEffect(() => {
    function handleKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!loading && logContent.trim()) {
          handleAnalyze();
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [logContent, loading, inputType, effectiveService, environment, correlationId]);

  const handleAnalyze = useCallback(async () => {
    if (!logContent.trim() || loading) return;
    setLoading(true);
    setResult(null);

    const context = {
      serviceName: effectiveService,
      environment,
      correlationId,
    };

    try {
      const res = await analyzeWithAI(inputType, context, logContent);
      setResult(res);
      setHistory((prev) => {
        const entry = {
          id: Date.now(),
          timestamp: new Date().toLocaleString(),
          inputType,
          serviceName: effectiveService,
          environment,
          summary: res.summary,
          result: res,
          logContent,
          correlationId,
        };
        return [entry, ...prev].slice(0, MAX_HISTORY);
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [logContent, loading, inputType, effectiveService, environment, correlationId]);

  function loadFromHistory(entry) {
    setInputType(entry.inputType);
    setServiceName(
      SERVICES.includes(entry.serviceName) ? entry.serviceName : "__custom"
    );
    if (!SERVICES.includes(entry.serviceName)) {
      setCustomService(entry.serviceName);
    }
    setEnvironment(entry.environment);
    setCorrelationId(entry.correlationId || "");
    setLogContent(entry.logContent);
    setResult(entry.result);
  }

  function resultToText(res) {
    if (!res) return "";
    return [
      `## Summary\n${res.summary}`,
      `## Root Cause\n${res.rootCause}`,
      `## Affected Services\n${res.affectedServices.map((s) => `- ${s}`).join("\n")}`,
      `## Severity\n${res.severity}`,
      `## Suggested Fix\n${res.suggestedFix}`,
      `## Related Patterns\n${res.relatedPatterns.map((s) => `- ${s}`).join("\n")}`,
    ].join("\n\n");
  }

  function handleCopy() {
    navigator.clipboard.writeText(resultToText(result)).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    });
  }

  function handleExport() {
    const md = `# Log Insight Analysis\n\n**Service:** ${effectiveService}  \n**Environment:** ${environment}  \n**Type:** ${inputType}  \n**Date:** ${new Date().toLocaleString()}\n\n---\n\n${resultToText(result)}`;
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `log-insight-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const charCount = logContent.length;
  const overLimit = charCount > CHAR_SOFT_LIMIT;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* ── Top Nav ────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-green-500" />
          <h1 className="text-lg font-semibold tracking-tight">
            Log <span className="text-green-500">Insight</span>
          </h1>
          <span className="text-xs text-gray-500 border border-gray-700 rounded px-1.5 py-0.5 ml-1">
            v1.0
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors px-2 py-1 rounded hover:bg-gray-800"
            title="Toggle history"
          >
            {historyOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
            <Clock className="w-3.5 h-3.5" />
            <span>History ({history.length})</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── History Sidebar ──────────────────────────────────────────── */}
        <div
          className={`transition-all duration-300 border-r border-gray-800 bg-gray-900/50 overflow-hidden flex-shrink-0 ${
            historyOpen ? "w-72" : "w-0"
          }`}
        >
          <div className="w-72 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Recent Analyses
              </h3>
              {history.length > 0 && (
                <button
                  onClick={() => setHistory([])}
                  className="text-gray-500 hover:text-red-400 transition-colors"
                  title="Clear history"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="text-xs text-gray-600 italic">No analyses yet</p>
            ) : (
              <div className="space-y-2">
                {history.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => loadFromHistory(entry)}
                    className="w-full text-left p-3 rounded-lg bg-gray-800/50 hover:bg-gray-800 border border-gray-700/30 hover:border-green-500/30 transition-all group"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] text-gray-500 font-mono">
                        {entry.timestamp}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400">
                        {entry.inputType}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400">
                        {entry.environment}
                      </span>
                    </div>
                    <p className="text-xs text-gray-300 line-clamp-2 group-hover:text-gray-100 transition-colors">
                      {entry.summary}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Input Panel ──────────────────────────────────────────────── */}
        <div className="w-2/5 flex-shrink-0 flex flex-col border-r border-gray-800 bg-gray-900/30">
          {/* Input Type Tabs */}
          <div className="flex border-b border-gray-800">
            {INPUT_TYPES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setInputType(id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-all ${
                  inputType === id
                    ? "text-green-400 border-b-2 border-green-500 bg-gray-800/30"
                    : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/20"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">{label}</span>
              </button>
            ))}
          </div>

          {/* Context Fields */}
          <div className="p-4 space-y-3 border-b border-gray-800">
            <div className="grid grid-cols-2 gap-3">
              {/* Service */}
              <div>
                <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                  Service
                </label>
                <select
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-2.5 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/20 transition-colors"
                >
                  {SERVICES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  <option value="__custom">Custom...</option>
                </select>
                {serviceName === "__custom" && (
                  <input
                    type="text"
                    value={customService}
                    onChange={(e) => setCustomService(e.target.value)}
                    placeholder="Enter service name"
                    className="w-full mt-1.5 bg-gray-800 border border-gray-700 rounded-md px-2.5 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/20"
                  />
                )}
              </div>

              {/* Environment */}
              <div>
                <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                  Environment
                </label>
                <div className="flex rounded-md overflow-hidden border border-gray-700">
                  {ENVIRONMENTS.map((env) => (
                    <button
                      key={env}
                      onClick={() => setEnvironment(env)}
                      className={`flex-1 py-1.5 text-xs font-medium transition-all ${
                        environment === env
                          ? env === "PROD"
                            ? "bg-red-500/20 text-red-400 border-red-500/30"
                            : "bg-green-500/20 text-green-400"
                          : "bg-gray-800 text-gray-500 hover:text-gray-300"
                      }`}
                    >
                      {env}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Correlation ID */}
            <div>
              <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                Correlation ID{" "}
                <span className="text-gray-600">(optional)</span>
              </label>
              <input
                type="text"
                value={correlationId}
                onChange={(e) => setCorrelationId(e.target.value)}
                placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-2.5 py-1.5 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/20 transition-colors"
              />
            </div>
          </div>

          {/* Main Text Area */}
          <div className="flex-1 flex flex-col p-4">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={logContent}
                onChange={(e) => setLogContent(e.target.value)}
                placeholder={PLACEHOLDERS[inputType]}
                className="w-full h-full bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 text-sm font-mono text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/20 transition-colors leading-relaxed"
                spellCheck={false}
              />
            </div>

            {/* Footer: char count + analyze button */}
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-mono ${overLimit ? "text-yellow-400" : "text-gray-500"}`}
                >
                  {charCount.toLocaleString()} chars
                </span>
                {overLimit && (
                  <span className="flex items-center gap-1 text-xs text-yellow-400">
                    <AlertTriangle className="w-3 h-3" />
                    Exceeds {CHAR_SOFT_LIMIT.toLocaleString()} soft limit
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-600">
                  {navigator.platform?.includes("Mac") ? "Cmd" : "Ctrl"}+Enter
                </span>
                <button
                  onClick={handleAnalyze}
                  disabled={!logContent.trim() || loading}
                  className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Analyze
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Output Panel ─────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-900/10">
          {/* Output Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
            <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Activity className="w-4 h-4 text-green-500" />
              Analysis Output
            </h2>
            {result && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-2.5 py-1.5 rounded-md hover:bg-gray-800 transition-colors"
                >
                  {copyFeedback ? (
                    <>
                      <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy
                    </>
                  )}
                </button>
                <button
                  onClick={handleExport}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-2.5 py-1.5 rounded-md hover:bg-gray-800 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export .md
                </button>
              </div>
            )}
          </div>

          {/* Output Body */}
          <div className="flex-1 overflow-y-auto p-5">
            {loading ? (
              <SkeletonLoader />
            ) : result ? (
              <AnalysisOutput result={result} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-600">
                <Terminal className="w-12 h-12 mb-4 opacity-30" />
                <p className="text-sm mb-1">No analysis yet</p>
                <p className="text-xs text-gray-700">
                  Paste logs or a stack trace and click Analyze
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

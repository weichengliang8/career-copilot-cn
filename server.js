const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 5173);
const WEB_ROOT = path.join(__dirname, "apps", "web");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/search") {
      await handleSearch(url, res);
      return;
    }

    serveStatic(url, res);
  } catch (error) {
    sendJson(res, 500, { error: "server_error", message: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Career Copilot CN is running at http://localhost:${PORT}`);
});

async function handleSearch(url, res) {
  const keyword = clean(url.searchParams.get("keyword") || "后端");
  const city = clean(url.searchParams.get("city") || "");
  const source = clean(url.searchParams.get("source") || "all");

  if (!keyword) {
    sendJson(res, 400, { error: "missing_keyword", message: "请输入岗位关键词。" });
    return;
  }

  const tasks = [];
  if (source === "all" || source === "github") tasks.push(searchGithub(keyword, city));
  if (source === "all" || source === "v2ex") tasks.push(searchV2ex(keyword, city));

  const settled = await Promise.allSettled(tasks);
  const jobs = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const errors = settled
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason?.message || "未知来源检索失败");

  sendJson(res, 200, {
    query: { keyword, city, source },
    searchedAt: new Date().toISOString(),
    jobs: dedupeJobs(jobs).slice(0, 24),
    errors,
  });
}

async function searchGithub(keyword, city) {
  const queryParts = [
    keyword,
    city,
    "招聘",
    "in:title,body",
    "is:issue",
  ].filter(Boolean);

  const apiUrl = new URL("https://api.github.com/search/issues");
  apiUrl.searchParams.set("q", queryParts.join(" "));
  apiUrl.searchParams.set("sort", "updated");
  apiUrl.searchParams.set("order", "desc");
  apiUrl.searchParams.set("per_page", "12");

  const response = await fetchWithTimeout(apiUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "career-copilot-cn",
    },
  });

  if (!response.ok) throw new Error(`GitHub 检索失败：${response.status}`);

  const payload = await response.json();
  return (payload.items || [])
    .filter((item) => isLikelyJobPost(`${item.title}\n${item.body || ""}`, keyword, city))
    .map((item) => ({
      id: `github_${item.id}`,
      title: normalizeTitle(item.title),
      company: extractCompany(item.title, item.body) || "GitHub 招聘帖",
      location: city || extractLocation(`${item.title}\n${item.body}`) || "地点待确认",
      salary: extractSalary(`${item.title}\n${item.body}`),
      source: "GitHub Issues",
      sourceUrl: item.html_url,
      description: summarizeText(item.body || item.title),
      status: "待评估",
      discoveredAt: new Date().toISOString(),
    }));
}

async function searchV2ex(keyword, city) {
  const apiUrl = new URL("https://www.v2ex.com/api/topics/show.json");
  apiUrl.searchParams.set("node_name", "jobs");

  const response = await fetchWithTimeout(apiUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "career-copilot-cn",
    },
  });

  if (!response.ok) throw new Error(`V2EX 检索失败：${response.status}`);

  const payload = await response.json();
  const terms = [keyword, city].filter(Boolean);

  return (payload || [])
    .filter((topic) => terms.every((term) => `${topic.title}\n${topic.content}`.toLowerCase().includes(term.toLowerCase())))
    .filter((topic) => isLikelyJobPost(`${topic.title}\n${topic.content || ""}`, keyword, city))
    .slice(0, 12)
    .map((topic) => ({
      id: `v2ex_${topic.id}`,
      title: normalizeTitle(topic.title),
      company: extractCompany(topic.title, topic.content) || "V2EX 招聘帖",
      location: city || extractLocation(`${topic.title}\n${topic.content}`) || "地点待确认",
      salary: extractSalary(`${topic.title}\n${topic.content}`),
      source: "V2EX Jobs",
      sourceUrl: topic.url,
      description: summarizeText(topic.content || topic.title),
      status: "待评估",
      discoveredAt: new Date().toISOString(),
    }));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function serveStatic(url, res) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(WEB_ROOT, safePath);

  if (!filePath.startsWith(WEB_ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function clean(value) {
  return String(value).trim().slice(0, 80);
}

function dedupeJobs(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    const key = `${job.title}|${job.company}|${job.sourceUrl}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeTitle(title) {
  return String(title || "未命名岗位").replace(/\s+/g, " ").trim().slice(0, 80);
}

function extractCompany(title, body = "") {
  const text = `${title}\n${body}`;
  const patterns = [
    /公司[:：]\s*([^\n，,。]{2,30})/,
    /团队[:：]\s*([^\n，,。]{2,30})/,
    /([A-Za-z0-9\u4e00-\u9fa5]{2,30})(?:公司|科技|团队|工作室)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return "";
}

function extractLocation(text) {
  const cities = ["北京", "上海", "深圳", "广州", "杭州", "成都", "南京", "武汉", "苏州", "西安", "厦门", "长沙", "重庆", "远程"];
  return cities.find((city) => text.includes(city)) || "";
}

function extractSalary(text) {
  const match = text.match(/(\d{1,3}\s*[-~到]\s*\d{1,3}\s*[kK万]|[\d.]{1,4}\s*万[-~到]\s*[\d.]{1,4}\s*万|\d{1,3}\s*[kK])/);
  return match ? match[0].replace(/\s+/g, "") : "薪资待确认";
}

function isLikelyJobPost(text, keyword, city) {
  const lower = String(text || "").toLowerCase();
  const requiredTerms = [keyword, city].filter(Boolean).map((term) => term.toLowerCase());
  if (!requiredTerms.every((term) => lower.includes(term))) return false;

  const blockedSignals = [
    "每日信息流",
    "rss",
    "feed",
    "cve",
    "加拿大28",
    "担保平台",
    "开奖",
    "漏洞",
    "exploit",
    "课程",
    "训练营",
    "学习法",
    "学员",
    "第14期",
    "就业班",
    "油猴",
    "推荐架构",
    "技术选型",
    "浏览器插件",
    "本地 ai 匹配服务",
  ];
  if (blockedSignals.some((signal) => lower.includes(signal.toLowerCase()))) return false;

  const jobSignals = ["招聘", "招人", "内推", "岗位", "职位", "薪资", "简历", "投递", "面试", "remote", "hiring"];
  const score = jobSignals.reduce((total, signal) => total + (lower.includes(signal.toLowerCase()) ? 1 : 0), 0);
  return score >= 2;
}

function summarizeText(text) {
  return String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

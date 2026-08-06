const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 5173);
const WEB_ROOT = path.join(__dirname, "apps", "web");
const verticalSiteGroups = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "vertical-sites.json"), "utf8"));

if (process.argv.includes("--self-check")) {
  selfCheck();
  process.exit(0);
}

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
  const source = clean(url.searchParams.get("source") || "auto");
  const sourceUrl = String(url.searchParams.get("sourceUrl") || "").trim();

  if (!keyword) {
    sendJson(res, 400, { error: "missing_keyword", message: "请输入岗位关键词。" });
    return;
  }

  const tasks = [];
  if (source === "auto") tasks.push(searchSmart(keyword, city));
  if (source === "cn") tasks.push(searchCnPortals(keyword, city));
  if (source === "site") tasks.push(searchVerticalSite(keyword, city, sourceUrl));
  if (source === "v2ex") tasks.push(searchV2ex(keyword, city));
  if (source === "url") tasks.push(fetchPublicJobPage(cleanUrl(sourceUrl), keyword, city));

  const settled = await Promise.allSettled(tasks);
  const jobs = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const errors = settled
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason?.message || "未知来源检索失败");

  sendJson(res, 200, {
    query: { keyword, city, source, sourceUrl },
    searchedAt: new Date().toISOString(),
    jobs: dedupeJobs(jobs).slice(0, 24),
    errors,
  });
}

function searchSmart(keyword, city) {
  return [...recommendedSites(keyword, city), ...searchCnPortals(keyword, city)];
}

function searchVerticalSite(keyword, city, site) {
  if (!site.trim()) return recommendedSites(keyword, city);

  const host = cleanSite(site);
  return sitePortal(host, keyword, city, "自定义行业网站入口");
}

function recommendedSites(keyword, city) {
  const text = keyword.toLowerCase();
  const group = verticalSiteGroups.find((item) => new RegExp(item.keywords, "i").test(text));
  if (!group) return [];
  return group.sites.map((site) => sitePortal(site.host, keyword, city, group.label, site.name, site.url)).flat();
}

function sitePortal(host, keyword, city, label, name = host, directUrl = "") {
  const query = [city, keyword].filter(Boolean).join(" ");
  const baiduQuery = encodeURIComponent(`site:${host} ${query} 招聘`);
  const url = directUrl || `https://www.baidu.com/s?wd=${baiduQuery}`;
  return [
    {
      id: `site_${host}`,
      title: `${name}：${query}`,
      company: label,
      location: city || "不限城市",
      salary: "打开后筛选",
      source: host,
      sourceUrl: url,
      description: directUrl
        ? "内置垂直网站库入口。打开后在站内搜索岗位，再复制 JD 或岗位链接回来分析。"
        : "未找到稳定直达页，先用搜索引擎做站内检索。",
      status: "搜索入口",
      kind: "portal",
      discoveredAt: new Date().toISOString(),
    },
  ];
}

function searchCnPortals(keyword, city) {
  const query = [city, keyword].filter(Boolean).join(" ");
  const encoded = encodeURIComponent(query);
  return [
    ["Boss 直聘", `https://www.zhipin.com/web/geek/job?query=${encoded}`],
    ["猎聘", `https://www.liepin.com/zhaopin/?key=${encoded}`],
    ["智联招聘", `https://sou.zhaopin.com/?kw=${encoded}`],
    ["前程无忧", `https://we.51job.com/pc/search?keyword=${encoded}`],
  ].map(([name, url], index) => ({
    id: `portal_${index}`,
    title: `${name} 搜索：${query}`,
    company: "国内招聘搜索入口",
    location: city || "不限城市",
    salary: "打开后筛选",
    source: name,
    sourceUrl: url,
    description: "这个入口不绕过平台登录，也不抓取页面。打开后在招聘网站查看真实岗位，再复制 JD 或岗位链接回来分析。",
    status: "搜索入口",
    kind: "portal",
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

async function fetchPublicJobPage(sourceUrl, keyword, city) {
  if (!sourceUrl) throw new Error("请输入公开岗位页面链接");

  const response = await fetchWithTimeout(sourceUrl, {
    headers: {
      Accept: "text/html, text/plain;q=0.9, */*;q=0.8",
      "User-Agent": "career-copilot-cn",
    },
  });

  if (!response.ok) throw new Error(`公开页面读取失败：${response.status}`);

  const html = await response.text();
  const text = htmlToText(html);
  if (!isLikelyJobPost(text, keyword, city)) return [];

  return [
    {
      id: `url_${Date.now()}`,
      title: normalizeTitle(extractTitle(html) || keyword),
      company: extractCompany(text) || "公司待确认",
      location: city || extractLocation(text) || "地点待确认",
      salary: extractSalary(text),
      source: "公开网页",
      sourceUrl,
      description: summarizeText(text),
      status: "待评估",
      discoveredAt: new Date().toISOString(),
    },
  ];
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

function cleanUrl(value) {
  const text = String(value).trim();
  if (!text) return "";
  const url = new URL(text);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("只支持 http/https 链接");
  return url.toString();
}

function cleanSite(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("请输入行业垂直网站域名");
  const host = text.includes("://") ? new URL(text).hostname : text.split("/")[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) throw new Error("请输入有效域名，例如 buildinghr.com");
  return host.replace(/^www\./i, "");
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

function extractTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? htmlToText(match[1]) : "";
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
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

function selfCheck() {
  const assert = require("node:assert");
  assert.equal(isLikelyJobPost("上海 Java 后端招聘，薪资 20-30K，投递简历", "Java", "上海"), true);
  assert.equal(isLikelyJobPost("每日信息流 RSS Java 上海 CVE 漏洞", "Java", "上海"), false);
  assert.equal(extractSalary("薪资 18-30K，13薪"), "18-30K");
  assert.equal(htmlToText("<title>岗位</title><script>bad()</script> Java"), "岗位 Java");
  assert.equal(searchCnPortals("工程造价", "上海").length, 4);
  assert.equal(searchVerticalSite("工程造价", "上海", "buildinghr.com")[0].kind, "portal");
  assert.ok(searchVerticalSite("工程造价", "上海", "").length > 0);
  assert.ok(searchSmart("工程造价", "上海").length > 4);
  assert.ok(recommendedSites("护士", "上海").some((job) => job.source === "jobmd.cn"));
}

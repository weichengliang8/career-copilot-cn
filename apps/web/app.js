const STORAGE_KEY = "career-copilot-cn.jobs";

const statusOptions = ["待评估", "准备投递", "已投递", "已沟通", "已约面", "Offer", "不合适"];

const sampleJobs = [
  {
    title: "Java 后端开发工程师",
    company: "星河云数科技有限公司",
    location: "上海 浦东新区",
    salary: "18-30K",
    source: "Boss 直聘",
    sourceUrl: "https://example.com/jobs/java-backend",
    description:
      "负责业务系统后端开发，参与接口设计、数据库建模和性能优化。要求熟悉 Java、Spring Boot、MySQL、Redis，有 Docker 使用经验优先。",
    status: "待评估",
  },
  {
    title: "AI 软件工程师",
    company: "某某教育咨询有限公司",
    location: "杭州",
    salary: "25-40K",
    source: "微信群/飞书群",
    sourceUrl: "",
    description:
      "无经验可投，入职前统一培训，培训后推荐高薪岗位。名额有限，先到先得。",
    status: "待评估",
  },
];

const riskRules = [
  { pattern: /入职前|押金|买设备|收费|保证金/, weight: 30, message: "出现入职前收费、押金或买设备相关表述。" },
  { pattern: /培训贷|先培训后上岗|统一培训/, weight: 28, message: "出现培训贷或先培训后上岗相关风险。" },
  { pattern: /无经验.*高薪|小白.*高薪|0经验/, weight: 18, message: "出现无经验高薪类表述，建议确认真实性。" },
  { pattern: /外包|驻场|项目制/, weight: 12, message: "可能涉及外包、驻场或项目制，需要确认合同主体。" },
  { pattern: /销售|招生|邀约|电销/, weight: 16, message: "JD 中含销售或邀约词，需确认是否偏离目标岗位。" },
  { pattern: /名额有限|先到先得|快速入职/, weight: 10, message: "存在催促式招聘话术，建议谨慎判断。" },
];

const skillKeywords = ["Java", "Spring Boot", "MySQL", "Redis", "Docker", "Python", "React", "Vue", "Node", "SQL", "Linux"];

const form = document.querySelector("#jobForm");
const searchForm = document.querySelector("#searchForm");
const jobList = document.querySelector("#jobList");
const jobCount = document.querySelector("#jobCount");
const searchStatus = document.querySelector("#searchStatus");
const searchResults = document.querySelector("#searchResults");
const jobTemplate = document.querySelector("#jobCardTemplate");
const resultTemplate = document.querySelector("#resultCardTemplate");
const loadSampleBtn = document.querySelector("#loadSampleBtn");
const clearJobsBtn = document.querySelector("#clearJobsBtn");

let jobs = loadJobs();

renderJobs();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  addJob(Object.fromEntries(formData.entries()));
  form.reset();
});

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(searchForm);
  const params = new URLSearchParams(Object.fromEntries(formData.entries()));

  searchStatus.textContent = "检索中";
  searchResults.innerHTML = '<p class="empty">正在检索公开岗位来源...</p>';

  try {
    const response = await fetch(`/api/search?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) throw new Error(payload.message || "检索失败");

    renderSearchResults(payload.jobs, payload.errors);
    searchStatus.textContent = `${payload.jobs.length} 个结果`;
  } catch (error) {
    searchStatus.textContent = "检索失败";
    searchResults.innerHTML = `<p class="empty">${error.message}。请确认本地服务已启动，并且网络可访问公开来源。</p>`;
  }
});

loadSampleBtn.addEventListener("click", () => {
  jobs = sampleJobs.map(prepareJob);
  saveJobs();
  renderJobs();
});

clearJobsBtn.addEventListener("click", () => {
  jobs = [];
  saveJobs();
  renderJobs();
});

function addJob(job) {
  const prepared = prepareJob(job);
  const duplicate = jobs.some((item) => getJobKey(item) === getJobKey(prepared));
  if (!duplicate) {
    jobs = [prepared, ...jobs];
    saveJobs();
  }
  renderJobs();
}

function prepareJob(job) {
  return {
    id: job.id || crypto.randomUUID(),
    title: job.title || "未命名岗位",
    company: job.company || "公司待确认",
    location: job.location || "地点待确认",
    salary: job.salary || "薪资待确认",
    source: job.source || "手动导入",
    sourceUrl: job.sourceUrl || "",
    description: job.description || "",
    status: job.status || "待评估",
    createdAt: job.createdAt || new Date().toISOString(),
  };
}

function loadJobs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

function saveJobs() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

function analyzeJob(job) {
  const text = `${job.title} ${job.company} ${job.salary} ${job.description}`;
  const risks = riskRules.filter((rule) => rule.pattern.test(text));
  const riskPenalty = risks.reduce((sum, rule) => sum + rule.weight, 0);
  const matched = skillKeywords.filter((keyword) => new RegExp(keyword, "i").test(text));
  const matchScore = clamp(45 + matched.length * 8 - Math.min(riskPenalty, 24), 20, 96);
  const trustScore = clamp(78 - riskPenalty + evidenceBonus(job), 8, 96);

  return {
    matchScore,
    trustScore,
    risks: risks.length ? risks.map((risk) => risk.message) : ["暂未发现明显风险信号，仍建议核对合同主体和薪资结构。"],
    questions: buildQuestions(risks),
    opening: buildOpening(job, matched),
  };
}

function evidenceBonus(job) {
  let score = 0;
  if (job.sourceUrl) score += 5;
  if (job.location && job.location !== "地点待确认") score += 4;
  if (job.salary && job.salary !== "薪资待确认") score += 4;
  if ((job.description || "").length > 80) score += 5;
  return score;
}

function buildQuestions(risks) {
  const base = [
    "这个岗位是贵司直招还是外包/驻场？",
    "入职后的劳动合同主体是哪家公司？",
    "薪资结构是固定薪资，还是包含绩效、补贴或提成？",
  ];
  const riskQuestions = risks.some((risk) => risk.weight >= 28)
    ? ["是否存在培训费、服务期、违约金或入职前收费？"]
    : ["该岗位所在团队主要负责什么业务？"];
  return [...riskQuestions, ...base].slice(0, 4);
}

function buildOpening(job, matched) {
  const skills = matched.slice(0, 4).join("、") || "相关项目";
  return `您好，我看到贵司正在招聘${job.title}，我有${skills}经验，岗位内容和我的经历比较匹配。方便的话希望进一步沟通岗位职责和团队情况。`;
}

function renderSearchResults(results, errors = []) {
  searchResults.innerHTML = "";

  if (errors.length) {
    const note = document.createElement("p");
    note.className = "notice";
    note.textContent = `部分来源暂不可用：${errors.join("；")}`;
    searchResults.appendChild(note);
  }

  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "没有搜到合适结果。可以换一个关键词，或只搜 GitHub/V2EX 单一来源。";
    searchResults.appendChild(empty);
    return;
  }

  results.forEach((job) => {
    const card = resultTemplate.content.cloneNode(true);
    setText(card, "title", job.title);
    setText(card, "company", job.company);
    setText(card, "location", job.location || "地点待确认");
    setText(card, "salary", job.salary || "薪资待确认");
    setText(card, "source", job.source);
    setText(card, "description", job.description || "暂无摘要");

    const link = card.querySelector('[data-field="sourceUrl"]');
    link.href = job.sourceUrl || "#";
    link.style.display = job.sourceUrl ? "" : "none";

    const importButton = card.querySelector('[data-action="import"]');
    importButton.disabled = jobs.some((item) => getJobKey(item) === getJobKey(job));
    importButton.textContent = importButton.disabled ? "已导入" : "导入岗位池";
    importButton.addEventListener("click", () => {
      addJob(job);
      importButton.disabled = true;
      importButton.textContent = "已导入";
    });

    searchResults.appendChild(card);
  });
}

function renderJobs() {
  jobCount.textContent = `${jobs.length} 个岗位`;
  jobList.innerHTML = "";

  if (!jobs.length) {
    jobList.innerHTML = '<p class="empty">还没有岗位，先检索公开职位，或手动导入一个 JD。</p>';
    return;
  }

  jobs.forEach((job) => {
    const analysis = analyzeJob(job);
    const card = jobTemplate.content.cloneNode(true);
    setText(card, "title", job.title);
    setText(card, "company", job.company);
    setText(card, "location", job.location || "地点待确认");
    setText(card, "salary", job.salary || "薪资待确认");
    setText(card, "source", job.source || "来源未标记");
    setText(card, "matchScore", `${analysis.matchScore}`);
    setText(card, "trustScore", `${analysis.trustScore}`);
    setText(card, "opening", analysis.opening);

    const status = card.querySelector('[data-field="status"]');
    statusOptions.forEach((option) => {
      if (![...status.options].some((item) => item.value === option)) {
        status.add(new Option(option, option));
      }
    });
    status.value = job.status || "待评估";
    status.addEventListener("change", () => {
      job.status = status.value;
      saveJobs();
    });

    fillList(card, "risks", analysis.risks);
    fillList(card, "questions", analysis.questions);
    jobList.appendChild(card);
  });
}

function setText(root, field, value) {
  root.querySelector(`[data-field="${field}"]`).textContent = value;
}

function fillList(root, field, items) {
  const list = root.querySelector(`[data-field="${field}"]`);
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  });
}

function getJobKey(job) {
  return `${job.title}|${job.company}|${job.sourceUrl || job.description}`.toLowerCase();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const STORAGE_KEY = "career-copilot-cn.jobs";

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
const jobList = document.querySelector("#jobList");
const jobCount = document.querySelector("#jobCount");
const template = document.querySelector("#jobCardTemplate");
const loadSampleBtn = document.querySelector("#loadSampleBtn");

let jobs = loadJobs();

render();

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const job = Object.fromEntries(formData.entries());
  job.id = crypto.randomUUID();
  job.status = "待评估";
  job.createdAt = new Date().toISOString();
  jobs = [job, ...jobs];
  saveJobs();
  form.reset();
  render();
});

loadSampleBtn.addEventListener("click", () => {
  jobs = sampleJobs.map((job) => ({
    ...job,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }));
  saveJobs();
  render();
});

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
  if (job.location) score += 4;
  if (job.salary) score += 4;
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

function render() {
  jobCount.textContent = `${jobs.length} 个岗位`;
  jobList.innerHTML = "";

  if (!jobs.length) {
    jobList.innerHTML = '<p class="empty">还没有岗位，先导入一个 JD 试试看。</p>';
    return;
  }

  jobs.forEach((job) => {
    const analysis = analyzeJob(job);
    const card = template.content.cloneNode(true);
    setText(card, "title", job.title);
    setText(card, "company", job.company);
    setText(card, "location", job.location || "地点待确认");
    setText(card, "salary", job.salary || "薪资待确认");
    setText(card, "source", job.source || "来源未标记");
    setText(card, "matchScore", `${analysis.matchScore}`);
    setText(card, "trustScore", `${analysis.trustScore}`);
    setText(card, "opening", analysis.opening);

    const status = card.querySelector('[data-field="status"]');
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

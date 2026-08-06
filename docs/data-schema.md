# 数据结构草案

## Job

```json
{
  "id": "job_001",
  "title": "Java 后端开发工程师",
  "company": "某科技有限公司",
  "location": "上海",
  "salary": "18-30K",
  "source": "Boss 直聘",
  "sourceUrl": "https://example.com/job/1",
  "description": "岗位职责和要求原文",
  "status": "待评估",
  "createdAt": "2026-08-06T00:00:00+08:00",
  "updatedAt": "2026-08-06T00:00:00+08:00"
}
```

## JobAnalysis

```json
{
  "jobId": "job_001",
  "matchScore": 82,
  "trustScore": 68,
  "recommendation": "谨慎投递",
  "matchedKeywords": ["Spring Boot", "MySQL", "Redis"],
  "missingKeywords": ["Kubernetes", "高并发调优"],
  "riskSignals": [
    {
      "level": "medium",
      "type": "salary_mismatch",
      "message": "薪资高于同经验段常见水平，建议确认薪资结构"
    }
  ],
  "questionsForHr": [
    "这个岗位是公司直招还是外包/驻场？",
    "薪资结构是固定薪资还是包含绩效？"
  ]
}
```

## CandidateProfile

```json
{
  "name": "张三",
  "targetRoles": ["Java 后端开发", "后端开发工程师"],
  "targetCities": ["上海", "杭州", "远程"],
  "expectedSalary": "15-25K",
  "skills": ["Java", "Spring Boot", "MySQL", "Redis", "Docker"],
  "projects": [
    {
      "name": "订单系统",
      "summary": "负责接口设计、数据库建模和缓存优化",
      "skills": ["Spring Boot", "MySQL", "Redis"]
    }
  ],
  "avoid": ["培训贷", "入职前收费", "销售性质岗位"]
}
```

## Application

```json
{
  "id": "app_001",
  "jobId": "job_001",
  "status": "已沟通",
  "resumeVersion": "resume_java_backend_001",
  "openingMessage": "您好，我看到贵司正在招聘 Java 后端开发...",
  "notes": "HR 说明为自研岗位，下周一技术面",
  "nextActionAt": "2026-08-10T10:00:00+08:00"
}
```

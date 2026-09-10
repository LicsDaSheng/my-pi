import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name: string) => readFileSync(join(root, name), "utf8");
const agent = read("agents/development-designer.md");
const prompt = read("prompts/dev-plan.md");
const expectedDesignerTools = ["read", "grep", "find", "ls", "contact_supervisor"];
const portableContractFiles = [
  "agents/development-designer.md",
  "prompts/dev-plan.md",
  "README.md",
  "handbook/subagents/README.md",
  "handbook/subagents/dev-plan-workflow.md",
  "handbook/subagents/pi-subagents-config.md",
  "tests/dev-plan.test.ts",
  "tests/dev-plan.integration.test.ts",
  "package.json",
];
const providerQualifiedModelRoute = /\b(?:model|defaultModel|fallbackModels)\s*[:=]\s*["'`]?[a-z][\w.-]*\/[\w./-]+/i;
const canaryProviderQualifiedModel = "example-provider/example-model";

function agentFields(text: string) {
  const header = text.match(/^---\n([\s\S]*?)\n---\n/);
  expect(header, "agent 必须有 frontmatter").not.toBeNull();
  return Object.fromEntries(header![1].split("\n").map((line) => {
    const colon = line.indexOf(":");
    return [line.slice(0, colon), line.slice(colon + 1).trim()];
  }));
}

function parseReviewSchemaFromPrompt(text: string) {
  const schemas = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)];
  expect(schemas, "入口必须自带唯一评审 schema").toHaveLength(1);
  return JSON.parse(schemas[0][1]);
}

function assertReviewerSchemaContract(text: string) {
  const schema = parseReviewSchemaFromPrompt(text);
  expect(schema.required).toEqual(["reviewed_version", "verdict", "findings", "coverage_summary"]);
  expect(schema.properties.verdict.enum).toEqual(["pass", "revise", "needs_user_decision"]);
  expect(schema.additionalProperties).toBe(false);

  const finding = schema.properties.findings.items;
  expect(finding.required).toEqual(Object.keys(finding.properties));
  expect(finding.additionalProperties).toBe(false);
  expect(finding.properties.severity.enum).toEqual(["blocker", "major", "minor"]);
}

function assertNoConcreteModelTerms(fileTexts: Map<string, string>, forbiddenTerms: string[]) {
  for (const [file, text] of fileTexts) {
    for (const term of forbiddenTerms) {
      expect(text.toLowerCase(), `${file}: 不应硬编码具体模型或供应商：${term}`).not.toContain(term.toLowerCase());
    }
  }
}

function assertNoProviderQualifiedModelRouting(text: string, file: string) {
  expect(text, `${file}: 不应在项目契约中写入 provider-qualified 模型路由`).not.toMatch(providerQualifiedModelRoute);
}

function assertNoModelDenylistEncoding(fileTexts: Map<string, string>) {
  const encodingPatterns = [
    /(?:\b\d{2,3}\s*,\s*){8,}\b\d{2,3}\b/,
    /(?:\\x[0-9a-f]{2}){4,}/i,
    /(?:\\u00[0-9a-f]{2}){4,}/i,
  ];

  for (const [file, text] of fileTexts) {
    for (const pattern of encodingPatterns) {
      expect(text, `${file}: 不应用可还原编码保留模型或供应商 denylist`).not.toMatch(pattern);
    }
  }
}

function assertNoRunsRunModelParameter(text: string) {
  expect(text, "workflow runs.run 不能用每次调用的 model 参数覆盖用户级 settings 路由")
    .not.toMatch(/runs\.run\([^)]*\{[^)]*\bmodel\s*:/s);
}

function assertTargetCwdContract(text: string, file: string) {
  const preflights = [...text.matchAll(/subagent\(\{([^{}]*action:\s*"(list|models|get)"[^{}]*)\}\)/g)];
  for (const action of ["list", "models", "get"] as const) {
    const examples = preflights.filter((match) => match[2] === action);
    expect(examples.length, `${file}: 缺少 ${action} 预检示例`).toBeGreaterThan(0);
    for (const [, params] of examples) {
      expect(params, `${file}: ${action} 预检必须使用 cwd: targetCwd`).toMatch(/\bcwd:\s*targetCwd\b/);
      if (action === "list") {
        expect(params, `${file}: list 预检必须请求 capabilities`).toMatch(/\bcapabilities:\s*true\b/);
      }
    }
  }

  expect(text, `${file}: 必须定义绝对 targetCwd`).toContain('const targetCwd = "<目标仓库绝对路径>"');
  expect(text, `${file}: workflow 执行必须使用与预检相同的 cwd`).toMatch(/`async:\s*true`[^\n。]*`cwd:\s*targetCwd`/);
  for (const marker of ["所有配置预检", "同一 targetCwd", "有效同名 agent 覆盖", "工具", "fallbackModels"]) {
    expect(text, `${file}: 缺少目标 cwd 契约：${marker}`).toContain(marker);
  }
}

function replaceReviewSchema(text: string, schema: unknown) {
  return text.replace(/```json\n([\s\S]*?)\n```/, `\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``);
}

describe("dev-plan 包注册与设计角色", () => {
  it("通过社区包字段注册唯一 agent，并注册主会话提示词目录", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg["pi-subagents"].agents).toEqual(["./agents"]);
    expect(pkg.pi.agents).toBeUndefined();
    expect(pkg.pi.prompts).toContain("./prompts");
    expect(readdirSync(join(root, "agents"))).toEqual(["development-designer.md"]);
  });

  it("设计角色只拥有严格只读与访谈工具", () => {
    const fields = agentFields(agent);
    expect(fields.name).toBe("development-designer");
    expect(fields.tools.split(/,\s*/)).toEqual(expectedDesignerTools);
    expect(fields.systemPromptMode).toBe("replace");
    expect(fields.inheritSkills).toBe("false");
    expect(fields.acceptanceRole).toBe("read-only");
  });

  it("模型路由留给用户级 settings，不固定在 agent 定义", () => {
    expect(agentFields(agent).model).toBeUndefined();
  });

  it.each(["clarify", "draft", "revise"])("保留设计模式 %s", (mode) => {
    expect(agent).toContain(`\`${mode}\``);
  });
});

describe("dev-plan 主会话入口", () => {
  it("仅展开一次原始参数，且不将入口委托为子 agent", () => {
    expect(prompt.match(/\$ARGUMENTS/g) ?? []).toHaveLength(1);
    expect(prompt).not.toMatch(/^subagent:/m);
  });

  it("跨目标仓库自包含，不链接相对文件或个人安装路径", () => {
    expect(prompt).not.toMatch(/\]\((?:\.\.?\/|\/Users\/)/);
  });

  it("模型路由由用户级 agentOverrides 管理，workflow 不传 per-run model 参数", () => {
    expect(prompt).toContain("用户级 pi settings");
    expect(prompt).toContain("subagents.agentOverrides");
    assertNoRunsRunModelParameter(prompt);
  });

  // 这些断言保护已撰写的契约，不证明模型实际遵守编排行为。
  it.each([
    ["能力、模型与访谈", ["capabilities: true", 'action: "models"', "ask_user_question", "三个精确 agent"]],
    ["异步与会话恢复", ["async: true", 'context: "fresh"', 'action: "children.list"', "resumable"]],
    ["结构化评审门禁", ["structuredOutput", "fail closed", "review_count < review_limit", "默认最多 3 次"]],
    ["可恢复状态", ["state.set", "state.get", "missionId"]],
    ["产物与授权边界", ["outputReference", "development-plan.md", "REQ", "AC", "方案确认不等于授权编码"]],
  ] as const)("保留%s契约", (_name, markers) => {
    for (const marker of markers) expect(prompt, `缺少契约：${marker}`).toContain(marker);
  });
});

describe.each(["prompts/dev-plan.md", "handbook/subagents/dev-plan-workflow.md"])("%s 的目标 cwd 契约", (file) => {
  const text = read(file);

  it("list/models/get 预检和 workflow 执行都显式使用同一 targetCwd", () => {
    assertTargetCwdContract(text, file);
  });
});

describe("dev-plan 结构化评审 schema", () => {
  it("评审结果、结论和意见字段保持严格 JSON Schema", () => {
    assertReviewerSchemaContract(prompt);
  });
});

describe("dev-plan 可移植模型路由契约", () => {
  it("agent frontmatter 和 prompt 不含 provider-qualified 模型路由", () => {
    expect(agentFields(agent).model).toBeUndefined();
    assertNoProviderQualifiedModelRouting(prompt, "prompts/dev-plan.md");
    assertNoRunsRunModelParameter(prompt);
  });

  it("明确范围内的项目契约文件不使用可还原编码保留模型 denylist", () => {
    assertNoModelDenylistEncoding(new Map(portableContractFiles.map((file) => [file, read(file)])));
  });
});

describe("dev-plan 契约负例保护", () => {
  it("具体模型或供应商硬编码会被测试捕获", () => {
    const mutated = new Map([["prompts/dev-plan.md", `${prompt}\n${canaryProviderQualifiedModel}`]]);
    expect(() => assertNoConcreteModelTerms(mutated, [canaryProviderQualifiedModel])).toThrow(/不应硬编码具体模型或供应商/);
  });

  it("provider-qualified prompt 模型路由会被测试捕获", () => {
    const mutated = `${prompt}\nmodel: "${canaryProviderQualifiedModel}"`;
    expect(() => assertNoProviderQualifiedModelRouting(mutated, "mutated prompt")).toThrow(/provider-qualified 模型路由/);
  });

  it("workflow runs.run 传入 per-run model 参数会被测试捕获", () => {
    const mutated = prompt.replace("agent: \"scout\", context", `agent: "scout", model: "${canaryProviderQualifiedModel}", context`);
    expect(() => assertNoRunsRunModelParameter(mutated)).toThrow(/不能用每次调用的 model 参数/);
  });

  it("缺少 targetCwd 的配置预检会被测试捕获", () => {
    const mutated = prompt.replace('subagent({ action: "models", cwd: targetCwd })', 'subagent({ action: "models" })');
    expect(() => assertTargetCwdContract(mutated, "mutated prompt")).toThrow(/models 预检必须使用 cwd: targetCwd/);
  });

  it("workflow 执行未绑定 targetCwd 会被测试捕获", () => {
    const mutated = prompt.replace("外层均 `async: true`、`cwd: targetCwd`", "外层均 `async: true`");
    expect(() => assertTargetCwdContract(mutated, "mutated prompt")).toThrow(/workflow 执行必须使用与预检相同的 cwd/);
  });

  it("评审 schema 允许额外字段会被测试捕获", () => {
    const schema = parseReviewSchemaFromPrompt(prompt);
    schema.additionalProperties = true;
    expect(() => assertReviewerSchemaContract(replaceReviewSchema(prompt, schema))).toThrow(/expected true to be false/);
  });
});

describe("dev-plan 文档导航", () => {
  it.each(["README.md", "handbook/subagents/README.md", "handbook/subagents/dev-plan-workflow.md"])(
    "%s 的本地链接均可访问", (file) => {
      for (const match of read(file).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = match[1].split("#")[0];
        if (!target || /^[a-z]+:/i.test(target)) continue;
        expect(existsSync(resolve(root, dirname(file), target)), `${file}：链接失效 ${target}`).toBe(true);
      }
    },
  );
});

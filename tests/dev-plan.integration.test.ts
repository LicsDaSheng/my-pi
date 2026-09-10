import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registeredLoaders = new Set<string>();

function registerRestrictedTypeScriptLoader(packageRoot: string) {
  const normalizedRoot = resolve(packageRoot);
  if (registeredLoaders.has(normalizedRoot)) return;

  registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith("file:") || !url.endsWith(".ts")) return nextLoad(url, context);

      const filePath = resolve(fileURLToPath(url));
      if (filePath !== normalizedRoot && !filePath.startsWith(`${normalizedRoot}${sep}`)) {
        return nextLoad(url, context);
      }

      return {
        format: "module",
        shortCircuit: true,
        source: stripTypeScriptTypes(readFileSync(filePath, "utf8"), { mode: "strip" }),
      };
    },
  });
  registeredLoaders.add(normalizedRoot);
}

// 普通 npm test 不加载外部源码；显式设置 PI_SUBAGENTS_ROOT 后，路径或加载错误必须失败。
describe.skipIf(process.env.PI_SUBAGENTS_ROOT === undefined)("dev-plan 真实 pi-subagents 包发现", () => {
  it("从隔离的其他目标 cwd 发现包级设计角色并保留只读配置", async () => {
    const packageRoot = process.env.PI_SUBAGENTS_ROOT;
    expect(packageRoot, "必须设置 PI_SUBAGENTS_ROOT 为真实 pi-subagents 包根绝对路径").toBeTruthy();
    expect(isAbsolute(packageRoot!), "PI_SUBAGENTS_ROOT 必须是绝对路径").toBe(true);

    const packageJsonPath = join(packageRoot!, "package.json");
    expect(existsSync(packageJsonPath), "包根必须包含 package.json").toBe(true);
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    expect(pkg.name, "配置路径必须指向 pi-subagents 包").toBe("pi-subagents");

    const entry = join(packageRoot!, "src/agents/agents.ts");
    expect(existsSync(entry), "包中必须存在真实 discovery 源码").toBe(true);
    registerRestrictedTypeScriptLoader(packageRoot!);

    const temp = mkdtempSync(join(tmpdir(), "dev-plan-discovery-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    try {
      process.env.PI_CODING_AGENT_DIR = join(temp, "isolated-agent");
      mkdirSync(join(temp, ".pi"));
      writeFileSync(join(temp, ".pi", "settings.json"), JSON.stringify({ packages: [root] }));

      const { discoverAgents } = await import(/* @vite-ignore */ pathToFileURL(entry).href);
      const result = discoverAgents(temp, "project");
      const found = result.agents.find((agent: { name: string }) => agent.name === "development-designer");

      expect(found, "必须从另一目标 cwd 发现包中的 development-designer").toBeDefined();
      expect(found.source).toBe("package");
      expect(resolve(found.filePath)).toBe(join(root, "agents/development-designer.md"));
      expect(found.tools).toEqual(["read", "grep", "find", "ls", "contact_supervisor"]);
      expect(found.systemPromptMode).toBe("replace");
      expect(found.inheritSkills).toBe(false);
      expect(found.acceptanceRole).toBe("read-only");
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

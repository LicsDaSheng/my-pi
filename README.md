# my-pi

个人 pi 扩展包仓库，用于沉淀自用的 extensions、skills、prompts 和 themes。

## 目录结构

```text
extensions/  # pi TypeScript 扩展
skills/      # 自定义技能（每个技能目录包含 SKILL.md）
prompts/     # Prompt 模板
themes/      # 主题 JSON
```

## 本地开发

```bash
# 临时加载扩展测试
pi -e ./extensions/hello.ts

# 或安装为本地包
pi install ./
```

修改后在 pi 中使用 `/reload` 重新加载。

## 从 GitHub 安装

发布到 GitHub 后可使用：

```bash
pi install git:github.com/<your-user>/my-pi
```

如需固定版本，给仓库打 tag 后安装：

```bash
pi install git:github.com/<your-user>/my-pi@v0.1.0
```

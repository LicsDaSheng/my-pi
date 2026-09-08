---
name: context-mode
description: "在 pi 中默认使用上下文节约模式处理可能产生大输出的操作。触发场景：分析日志、汇总/处理大数据、解析 JSON、过滤结果、提取错误、查看构建/测试输出、git diff/log、API 响应、代码库统计、依赖分析、CI/CD 输出等。适用于任何可能超过 20 行的命令或工具输出。"
---

# Context Mode：默认对大输出走「写文件 + 按需读取」

## 强制规则

**默认先判断输出规模，只有「保证小输出」的操作才直接跑 bash。**

Bash 白名单（可以直接执行）：
- **文件变更**：`mkdir`、`mv`、`cp`、`rm`、`touch`、`chmod`
- **Git 写操作**：`git add`、`git commit`、`git push`、`git checkout`、`git branch`、`git merge`
- **导航**：`cd`、`pwd`、`which`
- **简单输出**：`echo`、`printf`

**其它一切 → 先输出到文件，再用 read/grep 只读取需要的片段。**

任何读取、查询、抓取、列出、日志、测试、构建、diff、检查或外部服务调用的命令都适用。
gh、aws、kubectl、docker、terraform 等 CLI 数以千计，无法穷举——拿不准就跑上下文节约模式。

## 决策树

```
准备执行命令 / 读文件 / 调 API？
│
├── 命令在白名单（文件变更、git 写、导航、echo）？
│   └── 直接 bash
│
├── 输出「可能」很大，或你不确定？
│   └── 先 `... > /tmp/x.txt` 或 `curl -s -o /tmp/x.json URL`，
│       再 read/grep 只读需要的片段
│
├── 需要「统计 / 解析 / 分析多个文件」？
│   └── 写一段脚本在本地计算，只 console.log 结果
│
├── 抓取网页 / API 文档 / 原始响应？
│   └── curl/wget 静默下载到文件，再 read/grep 提取
│
└── 处理另一个工具已进上下文的输出？
    ├── 输出已在上下文里 → 直接使用，不要重复抓取
    ├── 需要多次检索同一份输出 → 先存文件，再按需 read/grep
    └── 一次性提取 → 存文件后用 read/grep 精确提取
```

## 为什么要这样

每一 KB 无谓的上下文都会降低整场会话的质量与速度。把 LLM 当「代码生成器」而不是「数据处理器」：
用一段脚本替换十次工具调用，能省下 100 倍上下文。

**示例**（Before：47 次 read ≈ 700KB。After：1 次脚本 ≈ 3.6KB）：

```bash
node -e 'const fs=require("fs"); fs.readdirSync("src").filter(f=>f.endsWith(".ts")).forEach(f=>console.log(f+": "+fs.readFileSync("src/"+f,"utf8").split("\n").length+" lines"))'
```

## 回顾历史

需要回顾本会话之前说过 / 做过 / 决定过什么时，先用 `ctx_search` 工具检索会话历史，
不要向用户重复询问已经解释过的内容。
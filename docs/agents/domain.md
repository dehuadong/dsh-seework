# Domain Docs

工程技能探索代码库时，如何消费本工程的领域文档。

## 探索之前先读这些

按本工程的文档归属入口 [`docs/AGENTS.md`](../AGENTS.md) 解析当前与历史的决定属主；决定登记在别处时读那个位置，不再新建一个竞争性的 ADR 目录。

- [`../../CONTEXT.md`](../../CONTEXT.md)：本工程是**单上下文**，根目录术语表就是唯一的领域入口；没有 `CONTEXT-MAP.md`，不要为它预建索引。
- [`../adr/`](../adr/)：动手之前读与本次工作相关的 ADR。
- Agent Notes：`node scripts/decisions/list.mjs` 只读列出记录目录（单上下文，未配置 `recordRoots`）；`--legacy` 可看未分区的记录。

这些文件不存在时**静默跳过**：不要指出缺失，也不要提前建议创建。术语或决定真正明确时，由 `/domain-modeling`（经 `/grill-with-docs` 与 `/improve-codebase-architecture` 触发）惰性建立。

## 文件结构

单上下文工程：

```
/
├── CONTEXT.md
├── docs/
│   ├── AGENTS.md          ← 文档归属入口
│   ├── adr/               ← 架构决定
│   └── design/            ← 详细设计（一个主题一份）
├── .agents/notes/         ← 变更与决策记录
└── src/                   ← 宿主与浏览器两半
```

## 使用术语表的词汇

输出里提到领域概念时（issue 标题、重构提案、假设、用例名），使用 `CONTEXT.md` 定义的那个词，不要漂移到术语表明确避免的同义词。需要而术语表里没有的概念是一个信号：要么你在发明项目不使用的语言（重新考虑），要么存在真实缺口（记下来交给 `/domain-modeling`）。

## 冲突要摆到明面上

输出与既有 ADR 矛盾时明确说清，不要静默覆盖：

> _与 ADR-0001（Agent 可见面的承载分工）冲突——但值得重新讨论，因为……_

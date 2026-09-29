# Agent Notes

写入前读取[记录规则](./README.md)、[项目配置](./config.json)并搜索同主题记录；已有决定优先更新原属主。目录编码生命周期、分类及已选择的上下文，`node scripts/decisions/list.mjs` 可只读查看目录。记录引用权威 Spec、RFC 和 ADR，只保留本次变更独有的理由、取舍、后果和验证。正文写法遵循项目[文档标准](../../docs/AGENTS.md)。

交付事实与实现保持同步。部分替代时互相链接并写清适用范围；完全替代先保留旧记录仍有价值的内容并修复引用，再删除旧文件。运行 `node scripts/decisions/check.mjs` 检查机械规则；批准真实性和实际交付仍需审阅。

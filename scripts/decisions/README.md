# Agent Notes 工具

从仓库管理根目录运行：

```sh
node scripts/decisions/check.mjs
node scripts/decisions/list.mjs
node scripts/decisions/list.mjs --context ordering  # replace with a configured context id
```

`check.mjs` 检查根配置、生命周期/分类目录、统一的元数据与正文格式、链接和记录文件名唯一性，并拒绝旧生成索引。`list.mjs` 根据配置和现有记录只读列出目录；选中的未来目录可以尚不存在。详情见[记录规则](../../.agents/notes/README.md)。两者不证明批准、决定或验证结果属实。

工具和配置属于目标项目。升级 setup 资源前逐文件核对项目定制，保留历史属主和脚本修补；不能用覆盖 README 或检查器的方式暗中迁移既有记录。删除旧 `INDEX.md` 前修复活动引用。

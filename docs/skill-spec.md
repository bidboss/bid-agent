# Skill 体系规范

本文档定义 `frontcode` 的 **Skill 体系**：目录结构、SKILL.md 格式、加载与注入策略、扩展方式。

> Rule 体系的规范见 [docs/rule-spec.md](rule-spec.md)。

---

## 一、目录约定

| 作用域 | 路径 | 优先级 |
|--------|------|--------|
| 项目级 | `<cwd>/.front/skills/<skill-name>/SKILL.md` | 高（同名覆盖用户级） |
| 用户级 | `~/.front/skills/<skill-name>/SKILL.md` | 低 |

执行 `frontcode` 启动时同时扫描两层目录，项目级同名 skill 覆盖用户级。

---

## 二、SKILL.md 格式

### 2.1 文件命名

- 目录名约定：**小写英文 + 连字符**（如 `architecture-diagram`、`read-code`）
- 目录内必须含 `SKILL.md`（大小写敏感）

### 2.2 Frontmatter 字段

```yaml
---
name: 架构图生成              # 必填，唯一标识，建议中文
preamble-tier: 1              # 必填，摘要注入层级：1=默认注入，>1=按需加载
version: 1.0.0                # 必填，遵循 semver
description: 一句话描述        # 必填，不超过 80 字
triggers:                     # 必填，触发关键词数组
  - 生成架构图
  - 画架构图
allowed-tools:                # 选填，允许使用的工具列表
  - read_file
  - grep
---
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 全局唯一标识；目录名可与 name 不同，但推荐一致 |
| `preamble-tier` | ✅ | 默认填 `1`，按需加载场景填 `>=2` |
| `version` | ✅ | semver，每次修改正文都要 bump 版本号 |
| `description` | ✅ | 一句话摘要，会出现在 system prompt 中 |
| `triggers` | ✅ | 关键词数组；模型据此判断是否需要 `skill_load` 调用 |
| `allowed-tools` | ❌ | 若声明，仅在该 skill 激活时可调用列出的工具 |

### 2.3 正文推荐结构

```markdown
# Skill: <name>

## when to use
当用户发送以下任意指令时立即触发…

## forbidden
- 禁止……

## 标准流程（可选）
### Stage 1: ……
### Stage 2: ……

## 全局硬约束（可选）
- ……
```

---

## 三、加载与注入策略

| 阶段 | 行为 | 入口 |
|------|------|------|
| 启动 | 扫描两层目录，读取所有 SKILL.md frontmatter | `scanSkills()` |
| 每轮对话 | 取 `preamble-tier <= 1` 的 skills 拼成 SystemMessage | `getSkillSummaryText(1)` |
| 模型按需 | 模型调用 `skill_load(name)` 工具读取完整内容 | `loadSkillFull(name)` |

注入位置：位于历史消息（`history`）之前、本轮 user input 之前。

---

## 四、扩展指引

### 4.1 新增 Skill

1. 在 `.front/skills/<skill-name>/` 下创建 `SKILL.md`
2. 按 2.2 写 frontmatter，按 2.3 写正文
3. 重启 CLI 即可自动加载

### 4.2 调整注入策略

- 跳过摘要：`preamble-tier` 改为 `>=2`
- 仅在某项目生效：放项目级 `.front/skills/`
- 全用户生效：放用户级 `~/.front/skills/`

---

## 五、关键代码索引

| 路径 | 职责 |
|------|------|
| `src/lc/skills.ts` | skill 扫描、摘要渲染、全文加载 |
| `src/lc/prompts.ts` | skill 摘要注入到 messages |

---

## 六、版本与变更

| 日期 | 变更 | 负责人 |
|------|------|--------|
| 2026-09-20 | 初始规范文档 | AI Assistant |
| 2026-09-20 | 从 `docs/skill&rule-spec.md` 拆出，专注 Skill 体系 | AI Assistant |

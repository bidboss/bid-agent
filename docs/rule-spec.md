# Rule 体系规范

本文档定义 `frontcode` 的 **Rule 体系**：目录结构、Rule.md 格式、glob 路径匹配、加载与注入策略、扩展方式。

> Skill 体系的规范见 [docs/skill-spec.md](skill-spec.md)。

---

## 一、目录约定

| 作用域 | 路径 | 优先级 |
|--------|------|--------|
| 项目级 | `<cwd>/.front/rules/<rule-name>.md` | 高 |
| 用户级 | `~/.front/rules/<rule-name>.md` | 低 |

执行 `frontcode` 启动时同时扫描两层目录，项目级同名 rule 覆盖用户级。

---

## 二、Rule.md 格式

```yaml
---
paths:
  - "src/lc/**/*.ts"
  - "**/*.test.ts"
---
```

`paths` 是 YAML 数组，每条是 minimatch glob，匹配成功即注入规则正文。
规则正文（去掉 frontmatter）会作为一段 `SystemMessage` 注入到本轮对话中。

---

## 三、glob 路径匹配扫盲

`paths` 数组内填写的是 **glob 路径匹配表达式**（一种通用文件通配语法）。

| 符号 | 含义 |
|------|------|
| `*` | 匹配当前目录任意文件名，不进入子目录 |
| `**` | 递归匹配所有子目录 |
| `*.{ts,js}` | 匹配多种后缀文件 |
| `?` | 匹配单个字符 |

**代码实现**：

- 路径匹配判断（`matchRulesForFiles`）：使用 `minimatch`，轻量，仅做路径字符串比对，不访问磁盘
- 匹配逻辑全部本地执行，大模型不读、不解析 glob 表达式；glob 仅作为本地筛选规则使用

### 3.1 常见示例

| glob | 命中文件 |
|------|----------|
| `src/lc/**/*.ts` | `src/lc/skills.ts`、`src/lc/foo/bar.ts` |
| `**/*.test.ts` | 任意目录下的 `*.test.ts` |
| `package.json` | 仅项目根的 `package.json` |
| `**/*.{ts,tsx}` | 任意目录的 `.ts` 与 `.tsx` |

---

## 四、加载与注入策略

| 阶段 | 行为 | 入口 |
|------|------|------|
| 每轮对话 | 从用户输入中提取 `@[file]` 列表 | `parseFileTagsFromInput(input)` |
| 每轮对话 | 按 paths glob 匹配，命中后注入 SystemMessage | `matchRulesForFiles(files, rules)` |

注入位置：位于历史消息（`history`）之前、本轮 user input 之前。

---

## 五、扩展指引

### 5.1 新增 Rule

1. 在 `.front/rules/` 下创建 `<rule-name>.md`
2. 用 `paths:` 声明触发该规则的文件 glob
3. 文件正文就是规则说明（可写 Markdown 段落 / 列表）

### 5.2 调整注入策略

- 仅在某项目生效：放项目级 `.front/rules/`
- 全用户生效：放用户级 `~/.front/rules/`
- 调试匹配：在 rule 文件名加 `z-` 前缀临时关闭（除 z 开头文件外，会被忽略），验证后再恢复

---

## 六、关键代码索引

| 路径 | 职责 |
|------|------|
| `src/lc/rules.ts` | rules 扫描、`@[…]` 解析、glob 匹配 |
| `src/lc/prompts.ts` | rules 命中内容注入到 messages |

---

## 七、版本与变更

| 日期 | 变更 | 负责人 |
|------|------|--------|
| 2026-09-20 | 初始规范文档 | AI Assistant |
| 2026-09-20 | 从 `docs/skill&rule-spec.md` 拆出，专注 Rule 体系 | AI Assistant |

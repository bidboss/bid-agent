// Skill / Rules（Phase 6）冒烟自检
// 验证：
// 1) 扫描 .front/skills/<name>/SKILL.md 并解析 frontmatter
// 2) getSkillSummaryText() 渲染摘要
// 3) loadSkillFull(name) 加载完整正文
// 4) 扫描 .front/rules/*.md，命中 @[file] 匹配规则
// 5) prompts.ts 能正确导入 skill / rules 模块
//
// 用法：npx tsx ./scripts/skill-smoke.ts

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'frontcode-skill-smoke-'));

  fs.mkdirSync(path.join(sandbox, '.front'), { recursive: true });
  fs.writeFileSync(
    path.join(sandbox, '.front', 'settings.json'),
    JSON.stringify({ baseURL: 'https://api.example.invalid/v1', apiKey: 'sk-smoke-fake', model: 'smoke-model' }),
    'utf-8',
  );

  // 项目级 skills：放两个测试 skill
  const skill1Dir = path.join(sandbox, '.front', 'skills', 'demo-skill');
  fs.mkdirSync(skill1Dir, { recursive: true });
  fs.writeFileSync(
    path.join(skill1Dir, 'SKILL.md'),
    `---
name: Demo Skill
preamble-tier: 1
version: 0.1.0
description: 用于 smoke 测试的示例 skill
triggers:
  - demo
  - smoke
allowed-tools:
  - read_file
---

# Demo Skill

正文内容…
`,
    'utf-8',
  );

  const skill2Dir = path.join(sandbox, '.front', 'skills', 'lazy-skill');
  fs.mkdirSync(skill2Dir, { recursive: true });
  fs.writeFileSync(
    path.join(skill2Dir, 'SKILL.md'),
    `---
name: Lazy Skill
preamble-tier: 2
version: 0.1.0
description: 按需加载的 skill，tier=2 不进默认摘要
triggers:
  - lazy
allowed-tools: []
---

lazy 内容…
`,
    'utf-8',
  );

  // 项目级 rules：写一条匹配 src/lc/**/*.ts 的规则
  const rulePath = path.join(sandbox, '.front', 'rules', 'lc-coding-style.md');
  fs.mkdirSync(path.dirname(rulePath), { recursive: true });
  fs.writeFileSync(
    rulePath,
    `---
paths:
  - "src/lc/**/*.ts"
  - "**/*.test.ts"
---

## LC 代码风格规则
- 严格模式开
- 函数必须有 JSDoc
- 不允许跨目录复用 legacy 工具
`,
    'utf-8',
  );

  // 用户级 sandbox：~/skill_smoke_userfront/skills/user-skill
  const userFrontHome = fs.mkdtempSync(path.join(os.tmpdir(), 'frontcode-userhome-'));
  const fakeUserSkill = path.join(userFrontHome, '.front', 'skills', 'user-skill');
  fs.mkdirSync(fakeUserSkill, { recursive: true });
  fs.writeFileSync(
    path.join(fakeUserSkill, 'SKILL.md'),
    `---
name: User Skill
preamble-tier: 1
version: 1.0.0
description: 用户级 skill，用于覆盖测试
triggers:
  - user
allowed-tools:
  - read_file
---

user 正文。
`,
    'utf-8',
  );

  // HOME 环境变量指向 userFrontHome，确保 getUserHomeDir() 走到我们的 sandbox
  const prevCwd = process.cwd();
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.chdir(sandbox);
  process.env.HOME = userFrontHome;
  process.env.USERPROFILE = userFrontHome;

  try {
    console.log('== 1. scanSkills 扫描 ==');
    const { scanSkills } = await import('../src/lc/skills.ts');
    const all = scanSkills();
    assert(all.length === 3, `扫描到 3 个 skill（含用户级 1 + 项目级 2），实际 ${all.length}`);
    const demo = all.find((s) => s.name === 'Demo Skill');
    assert(!!demo, '发现 Demo Skill');
    assert(demo!.preambleTier === 1, 'preamble-tier 解析为 1');
    assert(demo!.triggers.includes('demo'), 'triggers 数组正确解析');
    assert(demo!.allowedTools.includes('read_file'), 'allowed-tools 正确解析');
    assert(demo!.filePath.endsWith('SKILL.md'), 'filePath 指向 SKILL.md');
    assert(demo!.source === 'project', '来源 source 标记为 project');

    console.log('\n== 2. project 覆盖 user ==');
    // 在项目级再加一个同名 skill 覆盖
    const overrideDir = path.join(sandbox, '.front', 'skills', 'user-skill');
    fs.mkdirSync(overrideDir, { recursive: true });
    fs.writeFileSync(
      path.join(overrideDir, 'SKILL.md'),
      `---
name: User Skill
preamble-tier: 1
version: 2.0.0
description: 项目级覆盖
triggers:
  - user
allowed-tools: []
---

覆盖版正文。
`,
      'utf-8',
    );
    const reScanned = scanSkills();
    const overridden = reScanned.find((s) => s.name === 'User Skill');
    assert(overridden!.version === '2.0.0', '项目级同名 skill 覆盖用户级');
    assert(overridden!.source === 'project', '覆盖后 source 变 project');

    console.log('\n== 3. getSkillSummaryText 默认只注入 tier=1 ==');
    const { getSkillSummaryText } = await import('../src/lc/skills.ts');
    const t1 = getSkillSummaryText(1);
    assert(t1.includes('Demo Skill'), 'tier=1 摘要包含 Demo Skill');
    assert(!t1.includes('Lazy Skill'), 'tier=1 摘要不包含 Lazy Skill');
    assert(t1.includes('User Skill'), 'tier=1 摘要包含 User Skill');

    const t2 = getSkillSummaryText(2);
    assert(t2.includes('Lazy Skill'), 'tier=2 摘要包含 Lazy Skill');

    console.log('\n== 4. loadSkillFull ==');
    const { loadSkillFull } = await import('../src/lc/skills.ts');
    const full = loadSkillFull('Demo Skill');
    assert(full !== null, 'loadSkillFull 返回非空');
    assert(full!.includes('# Demo Skill'), '完整正文包含标题');
    const missing = loadSkillFull('Not Exists');
    assert(missing === null, '不存在的 skill 返回 null');

    console.log('\n== 5. rules 扫描 ==');
    const { scanRules, matchRulesForFiles, parseFileTagsFromInput } = await import('../src/lc/rules.ts');
    const rules = scanRules();
    assert(rules.length === 1, '扫描到 1 条 rule');
    assert(rules[0].id === 'lc-coding-style.md', 'rule id 正确');
    assert(rules[0].patterns.length === 2, 'paths 解析到 2 个 glob');
    assert(rules[0].body.includes('LC 代码风格规则'), '正文去掉 frontmatter 后正确');

    console.log('\n== 6. @[file] 解析 ==');
    const files = parseFileTagsFromInput('帮我看 @[src/lc/app.ts] 和 @[src/lc/skills.ts] 的逻辑');
    assert(files.length === 2, '提取出 2 个文件');
    assert(files[0] === 'src/lc/app.ts', '第一个文件名正确');
    assert(files[1] === 'src/lc/skills.ts', '第二个文件名正确');

    console.log('\n== 7. matchRulesForFiles 命中 ==');
    const matched = matchRulesForFiles(['src/lc/app.ts'], rules);
    assert(matched.includes('LC 代码风格规则'), '命中规则正文被注入');

    const notMatched = matchRulesForFiles(['README.md'], rules);
    assert(notMatched === '', '未命中规则返回空字符串');

    console.log('\n== 8. prompts.ts 集成 ==');
    const { buildSendMessages } = await import('../src/lc/prompts.ts');
    assert(typeof buildSendMessages === 'function', 'buildSendMessages 是函数');

    console.log('\n== 9. skill_load 工具注册 + 执行 ==');
    const { registerTool, getTool, executeTool, listTools } = await import('../src/lc/tools/registry.ts');
    const skillLoadImpl = (await import('../src/lc/tools/implementations/skill_load.ts')).default;
    registerTool(skillLoadImpl.name, skillLoadImpl.description, skillLoadImpl.schema, (args) => skillLoadImpl.execute(args as any));

    const def = getTool('skill_load');
    assert(!!def, 'getTool("skill_load") 命中');
    const names = listTools().map((t) => t.function.name);
    assert(names.includes('skill_load'), 'listTools() 包含 skill_load');

    const ok = await executeTool('skill_load', { name: 'Demo Skill' });
    assert(ok.success === true, '加载存在的 skill 成功');
    assert(ok.content.includes('# Demo Skill'), '返回完整正文');

    const notFound = await executeTool('skill_load', { name: 'Not Exists' });
    assert(notFound.success === false, '加载不存在的 skill 返回 success=false');
    assert(typeof notFound.error === 'string' && notFound.error.includes('Not Exists'), '错误信息包含传入的 name');

    console.log('\n全部自检通过');
  } finally {
    process.chdir(prevCwd);
    if (prevHome !== undefined) process.env.HOME = prevHome;
    else delete process.env.HOME;
    if (prevUserProfile !== undefined) process.env.USERPROFILE = prevUserProfile;
    else delete process.env.USERPROFILE;
    fs.rmSync(sandbox, { recursive: true, force: true });
    fs.rmSync(userFrontHome, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\nSkill 自检失败');
  console.error(err);
  process.exit(1);
});

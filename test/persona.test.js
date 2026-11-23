import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { apply, normalizePersona } from '../lib/index.js'
import { scorePattern, selectBestRule, tokenizeAscii } from '../lib/matcher.js'

const defaults = new URL('../defaults/', import.meta.url)
const builtinRules = JSON.parse(readFileSync(new URL('personas.json', defaults), 'utf8')).rules
const builtinText = id => readFileSync(new URL(`personas/${id}.md`, defaults), 'utf8').trim()
const API = '/api/dsh-model-persona'

function fixture(testContext, configure = () => ({}), services = true) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-model-persona-'))
  testContext.after(() => rmSync(root, { recursive: true, force: true }))
  const sections = new Map()
  const routes = new Map()
  const commands = new Map()
  const warnings = []
  const disposers = []
  const register = (store, key) => value => {
    store.set(value[key], value)
    return () => store.delete(value[key])
  }
  const ctx = {
    get(key) {
      return {
        dshHomePath: (...parts) => join(root, ...parts),
        connection: services ? { fetch: { register: register(routes, 'path') } } : undefined,
        commands: services ? { register: register(commands, 'name') } : undefined,
      }[key]
    },
    effect(registerEffect) { disposers.push(registerEffect()) },
    systemPrompt: { section: register(sections, 'name') },
    logger: { warn(message) { warnings.push(message) } },
  }
  const config = configure(root)
  apply(ctx, config)
  const section = sections.get(config.sectionName ?? 'model-persona')
  const personasDir = config.personasDir ?? join(root, 'personas')

  async function request(path, body, status = 200) {
    const route = routes.get(`${API}${path}`)
    assert.ok(route, `缺少路由 ${path}`)
    const method = path === '/status' ? 'GET' : 'POST'
    assert.deepEqual(route.methods, [method])
    assert.equal(route.requestBody, 'buffered')
    const response = await route.fetch(new Request(`http://localhost${API}${path}`, {
      method,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }))
    assert.equal(response.status, status)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    return response.json()
  }

  return {
    root, section, routes, commands, warnings, request, personasDir, rulesPath: join(personasDir, 'rules.json'),
    prompt: model => section.text({ modelSelection: { model } }),
    dispose: () => disposers.reverse().forEach(dispose => dispose()),
  }
}

test('ASCII 分词兼容模型版本、供应商前缀和标点', () => {
  assert.deepEqual(tokenizeAscii('linkapi'), ['linkapi'])
  assert.deepEqual(tokenizeAscii('[次]gpt-6.2sol'), ['gpt', '6', '2', 'sol'])
  assert.deepEqual(tokenizeAscii('zai_coding-glm5.3'), ['zai', 'coding', 'glm', '5', '3'])
  assert.deepEqual(tokenizeAscii('o3-mini'), ['o', '3', 'mini'])
  assert.equal(scorePattern('linkapi/[次]gpt-6.2sol', 'gpt-6.2-sol').score, 2240)
  assert.equal(scorePattern('【VIP】deepseek_v4', 'deepseek-v4').reason, 'slice')
  assert.equal(scorePattern('【特供】deepseek_v4', 'deepseek-v4').reason, 'exact')
  assert.equal(scorePattern('relay/xdeepseekv4', 'deepseek').reason, 'compact')
  assert.equal(scorePattern('relay/【内测】模型', '【内测】').reason, 'literal')
})

test('版本特化优先于通用规则，跨词命中限制间隔', () => {
  const model = 'linkapi/[次]gpt-6.2sol'
  const generic = { id: 'gpt', match: ['gpt'], source: 'user' }
  const rules = [
    generic,
    { id: 'gpt-sol', match: ['gpt-sol'] },
    { id: 'gpt-6.2', match: ['gpt-6.2'] },
    { id: 'gpt-6.2-sol', match: ['not-a-model', 'gpt-6.2-sol'] },
  ]
  assert.equal(selectBestRule(model, rules).rule.id, 'gpt-6.2-sol')
  assert.equal(selectBestRule(model, rules).matchedPattern, 'gpt-6.2-sol')
  assert.equal(selectBestRule(model, rules.slice(0, 3)).rule.id, 'gpt-6.2')
  assert.equal(selectBestRule(model, rules.slice(0, 2)).reason, 'ordered')
  assert.equal(scorePattern('claude-opus-5-5', 'claude-5.5').reason, 'ordered')
  assert.equal(scorePattern('gpt-a-b-c-d-e-sol', 'gpt-sol'), null)
  assert.equal(selectBestRule(model, [{ ...generic, source: 'builtin' }, generic]).rule, generic)
  assert.equal(selectBestRule(model, [{ ...generic, enabled: false }]), null)
})

test('模型段优先于供应商段，短别名必须有词边界', () => {
  for (const model of ['【VIP】deepseek_v4', 'freepi/deepseek-v4.1-flash-abliterated', 'claude-relay/deepseek-v4', 'openai/deepseek-v4']) {
    assert.equal(selectBestRule(model, builtinRules).rule.id, 'deepseek')
  }
  assert.equal(selectBestRule('autoclaw/zai_coding-glm5.3', builtinRules).rule.id, 'glm')
  assert.equal(selectBestRule('openai/o3-mini', builtinRules).matchedPattern, 'o3')
  assert.equal(selectBestRule('openai/o3', builtinRules).reason, 'exact')
  assert.equal(selectBestRule('local/foo3', builtinRules), null)
  assert.equal(selectBestRule('openai/unlisted', builtinRules).reason, 'provider')
  assert.equal(selectBestRule('multi/claude-relay/deepseek-v4', builtinRules).rule.id, 'deepseek')
})

test('直装使用九套包内规则，按会话当前模型切换且不创建配置', async context => {
  const plugin = fixture(context)
  const expected = {
    deepseek: 'deepseek-v4', gpt: 'linkapi/[次]gpt-6.2sol', gemini: 'google/gemini-3-pro',
    claude: 'claude-opus-5-5', glm: 'autoclaw/zai_coding-glm5.3', kimi: 'kimi-k2.6',
    qwen: 'qwen3.5', minimax: 'minimax-m2.7', grok: 'grok-4',
  }
  assert.equal(plugin.section.name, 'model-persona')
  assert.equal(plugin.section.order, 0)
  assert.equal(plugin.section.interpolate, false)
  for (const [id, model] of Object.entries(expected)) assert.equal(plugin.prompt(model), builtinText(id))
  assert.equal(plugin.prompt('unknown'), '')
  const status = await plugin.request('/status')
  assert.equal(status.hasUserRulesFile, false)
  assert.equal(status.personasDir, plugin.personasDir)
  assert.equal(status.rules.length, 9)
  for (const rule of status.rules) {
    assert.ok(rule.name && rule.nameEn && rule.match.length)
    assert.equal(rule.enabled, true)
    assert.equal(rule.source, 'builtin')
    assert.equal(rule.personaSource, 'builtin')
    assert.equal(rule.hasBuiltinPersona, true)
    assert.equal(rule.hasUserPersona, false)
  }
  assert.deepEqual(readdirSync(plugin.root), [])
})

test('本步固定模型覆盖实时选择，后者缺失时回退到会话初值和变量', context => {
  const plugin = fixture(context, () => ({ sectionName: 'persona-test', order: 3 }), false)
  const text = plugin.section.text
  let live = 'gpt-6.2'
  const agent = { model: { current: () => ({ model: live }) }, options: { model: 'grok-4' } }
  const variables = { model: 'gemini-3' }
  assert.equal(text({ agent, variables, modelSelection: { model: 'deepseek' } }), builtinText('deepseek'))
  assert.equal(text({ agent, variables }), builtinText('gpt'))
  live = 'glm-5.3'
  assert.equal(text({ agent, variables }), builtinText('glm'))
  agent.model.current = () => { throw new Error('model not initialized') }
  assert.equal(text({ agent, variables }), builtinText('grok'))
  assert.equal(text({ variables }), builtinText('gemini'))
  assert.equal(text(), '')
  assert.equal(plugin.section.order, 3)
})

test('同名本地 Markdown 自动覆盖、热更新并在删除后回退', async context => {
  const plugin = fixture(context)
  const file = join(plugin.personasDir, 'deepseek.md')
  mkdirSync(plugin.personasDir)
  writeFileSync(file, '# 私有人设')
  assert.equal(plugin.prompt('deepseek-v4'), '# 私有人设')
  writeFileSync(file, '# 热更新后的私有人设')
  assert.equal(plugin.prompt('deepseek-v4'), '# 热更新后的私有人设')
  const { match } = await plugin.request('/test', { model: 'deepseek-v4' })
  assert.equal(match.rule.id, 'deepseek')
  assert.equal(match.personaSource, 'user')
  assert.equal(match.content, '# 热更新后的私有人设')
  assert.equal(match.hasBuiltinPersona, true)
  assert.equal(match.hasUserPersona, true)
  rmSync(file)
  assert.equal(plugin.prompt('deepseek-v4'), builtinText('deepseek'))
  assert.deepEqual(readdirSync(plugin.personasDir), [])
})

test('外部映射替代默认规则，兼容旧格式与目录设置并热加载规则文件', context => {
  const plugin = fixture(context, root => {
    const mappingFile = join(root, 'mapping.json')
    mkdirSync(join(root, 'private'))
    writeFileSync(mappingFile, JSON.stringify({
      personasDir: 'private',
      rules: [
        { match: 'example-model', persona: 'custom.md' },
        { match: 'second-model', persona: 'custom.md' },
        { match: 'third-model', persona: '中文.md' },
        { match: 'evil', persona: '../outside.md' },
      ],
    }))
    writeFileSync(join(root, 'private', 'custom.md'), '# 外部映射')
    writeFileSync(join(root, 'private', '中文.md'), '# 中文文件名')
    writeFileSync(join(root, 'outside.md'), '目录外文件')
    return { mappingFile, personasDir: join(root, 'private') }
  })
  assert.equal(plugin.prompt('example-model'), '# 外部映射')
  assert.equal(plugin.prompt('second-model'), '# 外部映射')
  assert.equal(plugin.prompt('third-model'), '# 中文文件名')
  assert.equal(plugin.prompt('deepseek'), '')
  assert.equal(plugin.prompt('evil'), '')
  writeFileSync(plugin.rulesPath, JSON.stringify({
    rules: [{ id: 'other', match: 'other-model', persona: 'custom.md' }],
    disabled: ['custom'],
  }))
  assert.equal(plugin.prompt('example-model'), '')
  assert.equal(plugin.prompt('other-model'), '# 外部映射')
  rmSync(plugin.rulesPath)
  assert.equal(plugin.prompt('example-model'), '# 外部映射')
  assert.equal(plugin.prompt('other-model'), '')
})

test('可指定默认映射和正文目录，外部默认层仍保持只读', async context => {
  const plugin = fixture(context, root => {
    const defaultMappingFile = join(root, 'defaults.json')
    const defaultPersonasDir = join(root, 'templates')
    mkdirSync(defaultPersonasDir)
    writeFileSync(join(defaultPersonasDir, 'example.md'), '# 模板')
    writeFileSync(defaultMappingFile, JSON.stringify({ rules: [{ id: 'example', match: 'example', persona: 'example.md' }] }))
    return { defaultMappingFile, defaultPersonasDir, personasDir: root }
  })
  assert.equal(plugin.prompt('example'), '# 模板')
  assert.equal((await plugin.request('/persona/reset', { persona: 'templates/example.md' }, 400)).error, 'unsafe-path')
  assert.equal((await plugin.request('/persona/reset', { persona: 'defaults.json' }, 400)).error, 'unsafe-path')
  assert.equal(plugin.prompt('example'), '# 模板')
})

test('HTTP 保存版本规则、切换开关、恢复规则与重置正文', async context => {
  const plugin = fixture(context)
  const draft = {
    id: 'gpt-6.2-sol', name: 'GPT 6.2 Sol', match: ['gpt-6.2-sol', 'gpt-6.2sol'],
    persona: 'versions/gpt-6.2-sol.md', content: '# 版本专属正文',
  }
  const saved = await plugin.request('/rule/save', draft)
  assert.equal(saved.status.hasUserRulesFile, true)
  assert.equal(saved.status.rules.find(rule => rule.id === draft.id).source, 'custom')
  assert.equal(readFileSync(join(plugin.personasDir, draft.persona), 'utf8'), draft.content)
  const { match } = await plugin.request('/test', { model: 'linkapi/[次]gpt-6.2sol' })
  assert.equal(match.rule.id, draft.id)
  assert.equal(match.matchedPattern, 'gpt-6.2-sol')
  assert.equal(match.score, 2245)
  assert.equal(match.reason, 'exact')
  assert.equal(match.personaSource, 'user')
  assert.equal(plugin.prompt('linkapi/[次]gpt-6.2sol'), draft.content)
  const grok = builtinRules.find(rule => rule.id === 'grok')
  await plugin.request('/rule/save', { ...grok, enabled: false })
  assert.equal(plugin.prompt('grok-4'), '')
  assert.equal((await plugin.request('/test', { model: 'grok-4' })).match, null)
  assert.deepEqual(JSON.parse(readFileSync(plugin.rulesPath, 'utf8')).disabled, ['grok'])
  await plugin.request('/rule/delete', { id: 'grok' })
  assert.equal(plugin.prompt('grok-4'), builtinText('grok'))

  const deepseek = builtinRules.find(rule => rule.id === 'deepseek')
  const override = await plugin.request('/rule/save', { ...deepseek, name: '本地规则名', content: '# 本地正文' })
  assert.equal(override.status.rules.find(rule => rule.id === deepseek.id).source, 'override')
  const baseline = await plugin.request('/rule/delete', { id: deepseek.id })
  assert.equal(baseline.status.rules.find(rule => rule.id === deepseek.id).source, 'builtin')
  assert.equal(plugin.prompt('deepseek'), '# 本地正文')
  await plugin.request('/persona/reset', { persona: 'deepseek.md' })
  assert.equal(plugin.prompt('deepseek'), builtinText('deepseek'))

  const deleted = await plugin.request('/rule/delete', { id: draft.id, deleteFile: true })
  assert.equal(deleted.status.hasUserRulesFile, false)
  assert.equal(existsSync(join(plugin.personasDir, draft.persona)), false)
  assert.deepEqual(readdirSync(join(plugin.personasDir, 'versions')), [])
  assert.equal(plugin.prompt('linkapi/[次]gpt-6.2sol'), builtinText('gpt'))
})

test('规则和正文独立保存，冗余覆盖不会留下配置文件', async context => {
  const plugin = fixture(context)
  const deepseek = builtinRules.find(rule => rule.id === 'deepseek')
  const content = readFileSync(new URL('personas/deepseek.md', defaults), 'utf8')
  const unchanged = await plugin.request('/rule/save', { ...deepseek, content })
  assert.equal(unchanged.status.hasUserRulesFile, false)
  assert.deepEqual(readdirSync(plugin.root), [])
  await plugin.request('/rule/save', { ...deepseek, name: '临时改名' })
  assert.ok(existsSync(plugin.rulesPath))
  const restored = await plugin.request('/rule/save', { ...deepseek, content: '# 只存正文' })
  assert.equal(restored.status.hasUserRulesFile, false)
  assert.deepEqual(readdirSync(plugin.personasDir), ['deepseek.md'])
  await plugin.request('/persona/reset', { persona: 'deepseek.md' })
  assert.deepEqual(readdirSync(plugin.personasDir), [])
})

test('规则改名保留本地文件，冲突时不更新任何规则', async context => {
  const plugin = fixture(context)
  const draft = { id: 'first', name: 'First', match: 'first', persona: 'custom.md', content: '# 自定义正文', enabled: false }
  await plugin.request('/rule/save', draft)
  const conflict = await plugin.request('/rule/save', { ...draft, id: 'gpt', originalId: 'first' }, 400)
  assert.equal(conflict.error, 'rule-conflict')
  const renamed = await plugin.request('/rule/save', { ...draft, id: 'second', originalId: 'first', match: 'second', enabled: true })
  assert.ok(!renamed.status.rules.some(rule => rule.id === 'first'))
  assert.equal(plugin.prompt('second'), draft.content)
  assert.deepEqual(JSON.parse(readFileSync(plugin.rulesPath, 'utf8')).disabled, [])
  await plugin.request('/rule/delete', { id: 'second' })
  assert.deepEqual(readdirSync(plugin.personasDir), ['custom.md'])
})

test('清除规则 API 与斜杠命令恢复默认并保留用户正文，卸载时注销入口', async context => {
  const plugin = fixture(context)
  const rule = { ...builtinRules.find(rule => rule.id === 'deepseek'), enabled: false, content: '# 保留的私人正文' }
  await plugin.request('/rule/save', rule)
  assert.equal(plugin.prompt('deepseek'), '')
  const reset = await plugin.request('/reset-rules')
  assert.equal(reset.status.hasUserRulesFile, false)
  assert.equal(reset.status.rules.length, 9)
  assert.equal(plugin.prompt('deepseek'), rule.content)
  await plugin.request('/rule/save', rule)
  const command = plugin.commands.get('model-persona-clear')
  assert.equal(command.recordInput, false)
  const result = await command.handler()
  assert.equal(result.kind, 'success')
  assert.match(result.text, /Markdown 人设文件已保留/)
  assert.equal(plugin.prompt('deepseek'), rule.content)
  assert.deepEqual(readdirSync(plugin.personasDir), ['deepseek.md'])
  plugin.dispose()
  assert.equal(plugin.routes.size, 0)
  assert.equal(plugin.commands.size, 0)
})

test('connection 与 commands 在插件启动后异步就绪时仍可完成注册', async context => {
  const sections = new Map()
  const routes = new Map()
  const commands = new Map()
  const waiters = new Map()
  const root = mkdtempSync(join(tmpdir(), 'dsh-model-persona-async-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  const register = (store, key) => value => { store.set(value[key], value); return () => store.delete(value[key]) }
  const ctx = {
    get: key => key === 'dshHomePath' ? (...parts) => join(root, ...parts) : undefined,
    inject: ([service], callback) => waiters.set(service, callback),
    effect: fn => fn(),
    systemPrompt: { section: register(sections, 'name') },
  }
  apply(ctx, {})
  assert.ok(sections.has('model-persona'))
  assert.equal(routes.size, 0)
  const conn = { fetch: { register: register(routes, 'path') } }
  const cmds = { register: register(commands, 'name') }
  waiters.get('connection')({ get: k => k === 'connection' ? conn : undefined, effect: fn => fn() })
  waiters.get('commands')({ get: k => k === 'commands' ? cmds : undefined, effect: fn => fn() })
  assert.equal(routes.size, 6)
  assert.ok(commands.has('model-persona-clear'))
  const resp = await routes.get('/api/dsh-model-persona/status').fetch(new Request('http://localhost/api/dsh-model-persona/status'))
  assert.equal(resp.status, 200)
})

test('对非法路径和请求统一返回错误，且不创建目录或修改外部文件', async context => {
  const plugin = fixture(context)
  const outside = join(plugin.root, 'outside.md')
  writeFileSync(outside, '外部文件')
  for (const persona of ['../outside.md', 'nested/../../outside.md', '..\\outside.md', 'C:outside.md',
    '/tmp/outside.md', '\\\\server\\share\\outside.md', 'x\0.md', 'NUL.md', 'rules.json', 'dir. /evil.md']) {
    assert.throws(() => normalizePersona(persona), /invalid-persona/)
    const saved = await plugin.request('/rule/save', { id: 'x', match: 'x', persona, content: '写入失败' }, 400)
    assert.equal(saved.error, 'invalid-persona')
    assert.equal((await plugin.request('/persona/reset', { persona }, 400)).error, 'invalid-persona')
  }
  assert.equal((await plugin.request('/rule/save', { id: 'x', match: [], persona: 'x.md' }, 400)).error, 'bad-request')
  assert.equal((await plugin.request('/test', '{broken', 400)).error, 'bad-request')
  assert.equal((await plugin.request('/rule/delete', { id: 'absent' }, 400)).error, 'unknown-rule')
  assert.equal(readFileSync(outside, 'utf8'), '外部文件')
  assert.deepEqual(readdirSync(plugin.root), ['outside.md'])
})

test('目录联接不可用作正文访问路径，损坏的规则文件可独立清除', async context => {
  const plugin = fixture(context)
  const externalDir = join(plugin.root, 'external')
  mkdirSync(externalDir)
  mkdirSync(plugin.personasDir)
  writeFileSync(join(externalDir, 'secret.md'), '私有目录外文件')
  symlinkSync(externalDir, join(plugin.personasDir, 'link'), 'junction')
  writeFileSync(plugin.rulesPath, JSON.stringify({
    rules: [{ id: 'external', match: 'external', persona: 'link/secret.md' }], disabled: [],
  }))
  assert.equal(plugin.prompt('external'), '')
  assert.equal((await plugin.request('/persona/reset', { persona: 'link/secret.md' }, 400)).error, 'unsafe-path')
  writeFileSync(plugin.rulesPath, '{broken')
  assert.equal(plugin.prompt('gpt-6.2'), builtinText('gpt'))
  assert.equal((await plugin.request('/status')).hasUserRulesFile, true)
  assert.equal((await plugin.request('/reset-rules', {})).status.hasUserRulesFile, false)
  assert.equal(readFileSync(join(externalDir, 'secret.md'), 'utf8'), '私有目录外文件')
})

test('Web bundle 注册中英词典和两个设置入口，复用同一面板', () => {
  let bundle
  runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { bundle = value } } },
  })
  const client = bundle.factory(moduleName => {
    assert.equal(moduleName, 'react')
    return { createElement: (type, props, ...children) => ({ type, props, children }) }
  })
  assert.equal(bundle.id, 'dsh-model-persona')
  assert.deepEqual([...client.inject], ['slots', 'locale'])
  const dicts = new Map()
  const slots = new Map()
  let lang = 'zh'
  client.apply({
    effect: register => register(),
    locale: {
      register(namespace, key, dict) {
        assert.equal(namespace, 'model-persona')
        dicts.set(key, dict)
      },
      bind: () => key => dicts.get(lang)[key],
      subscribe: () => () => {},
      getSnapshot: () => lang,
    },
    slots: {
      inject: (_name, register) => register(),
      register: (meta, component) => slots.set(meta.name, { meta, component }),
    },
  })
  assert.deepEqual(Object.keys(dicts.get('en')).sort(), Object.keys(dicts.get('zh')).sort())
  const bundleConfig = slots.get('plugins.bundle.config')
  const settings = slots.get('settings.section')
  assert.equal(bundleConfig.meta.key, 'dsh-model-persona')
  assert.equal(settings.meta.id, 'model-persona')
  assert.equal(settings.meta.order, 47)
  assert.equal(settings.meta.label(), '模型人设')
  assert.equal(settings.component().props.localeStore.getSnapshot(), 'zh')
  lang = 'en'
  assert.equal(settings.meta.label(), 'Model Personas')
  assert.equal(settings.component().props.localeStore.getSnapshot(), 'en')
  assert.equal(bundleConfig.component().type, settings.component().type)
  assert.equal(slots.get('settings.section.icon').component().type, 'svg')
})

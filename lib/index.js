import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectBestRule } from './matcher.js'

export const name = 'model-persona'
export const inject = ['systemPrompt']

const PACKAGE_DIR = fileURLToPath(new URL('../', import.meta.url))
const DEFAULT_DIR = join(PACKAGE_DIR, 'defaults')
const API = '/api/dsh-model-persona'
const RULES_FILE = 'rules.json'
const textValue = value => typeof value === 'string' ? value.trim() : ''
const validId = value => /^[a-z0-9][a-z0-9._-]*$/i.test(value)

class InputError extends Error {}

function resolveFrom(base, value) {
  const path = textValue(value)
  if (path === '~') return homedir()
  if (/^~[/\\]/.test(path)) return resolve(homedir(), path.slice(2))
  return resolve(base, path)
}

export function normalizePersona(value) {
  const parts = textValue(value).replaceAll('\\', '/').split('/')
  if (parts[0].toLowerCase() === RULES_FILE || parts.some(part =>
    !part || /[\x00-\x1f<>:"|?*]/.test(part) || /[. ]$/.test(part) ||
    /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part),
  )) throw new InputError('invalid-persona')
  return parts.join('/')
}

function statOrNull(path) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function checkedPath(root, filename) {
  const parts = filename.split('/')
  let path = root
  // 逐层检查文件类型，拦截符号链接和 Windows 目录联接越出人设目录。
  for (const part of parts) {
    const stat = statOrNull(path)
    if (stat && !stat.isDirectory()) throw new InputError('unsafe-path')
    path = join(path, part)
  }
  const stat = statOrNull(path)
  if (stat && !stat.isFile()) throw new InputError('unsafe-path')
  return { path, stat }
}

function canonical(path) {
  const parent = dirname(path)
  if (statOrNull(path) || parent === path) return realpathSync.native(path)
  return join(canonical(parent), basename(path))
}

function contains(root, target) {
  const rel = relative(root, target)
  return rel !== '..' && !rel.startsWith(process.platform === 'win32' ? '..\\' : '../') && !isAbsolute(rel)
}

function normalizeMatch(value) {
  return [...new Set((Array.isArray(value) ? value : [value]).map(textValue).filter(Boolean).map(item => item.toLowerCase()))]
}

function readRule(raw, fallbackId = '') {
  try {
    const persona = normalizePersona(raw?.persona)
    const id = textValue(raw.id) || fallbackId
    const match = normalizeMatch(raw.match)
    if (!validId(id) || !match.length) return null
    const name = textValue(raw.name) || id
    return { id, name, nameEn: textValue(raw.nameEn) || name, match, persona, enabled: raw.enabled !== false }
  } catch (error) {
    if (error instanceof InputError) return null
    throw error
  }
}

function readBaseRules(raw) {
  const entries = Array.isArray(raw) ? raw : []
  const reserved = new Set(entries.map(entry => textValue(entry?.id)).filter(Boolean))
  const rules = new Map()
  for (const [index, entry] of entries.entries()) {
    if (textValue(entry?.id)) {
      const rule = readRule(entry)
      if (rule) rules.set(rule.id, rule)
      continue
    }
    // 旧映射没有 ID。能用文件名时保留其含义，否则分配稳定且唯一的 ID。
    const filename = textValue(entry?.persona).replaceAll('\\', '/')
    const stem = basename(filename, extname(filename))
    let id = validId(stem) && !reserved.has(stem) ? stem : `rule-${index + 1}`
    while (reserved.has(id)) id += '-rule'
    const rule = readRule(entry, id)
    if (!rule) continue
    reserved.add(id)
    rules.set(id, rule)
  }
  return rules
}

const ruleFields = ({ enabled, ...fields }) => fields
const sameRule = (left, right) => JSON.stringify(ruleFields(left)) === JSON.stringify(ruleFields(right))

function createStore(dshHome, config, warn) {
  const defaultMappingFile = resolveFrom(PACKAGE_DIR, config.defaultMappingFile || join(DEFAULT_DIR, 'personas.json'))
  // 外部映射接替包内规则表，同时保留独立的本地规则层和正文覆盖顺序。
  const mappingFile = textValue(config.mappingFile) ? resolveFrom(PACKAGE_DIR, config.mappingFile) : defaultMappingFile
  const defaultPersonasDir = resolveFrom(PACKAGE_DIR, config.defaultPersonasDir || join(DEFAULT_DIR, 'personas'))
  const cache = new Map()
  const warnings = new Set()

  function read(path, stat = statOrNull(path), parse = false) {
    if (!stat) {
      cache.delete(path)
      return null
    }
    const saved = cache.get(path)
    if (saved?.mtime === stat.mtimeMs && saved.size === stat.size && saved.parse === parse) return saved.value
    const body = readFileSync(path, 'utf8')
    const value = parse ? JSON.parse(body.replace(/^\uFEFF/, '')) : body
    cache.set(path, { mtime: stat.mtimeMs, size: stat.size, parse, value })
    return value
  }

  function readSafely(path, load) {
    try {
      const result = load()
      warnings.delete(path)
      return result
    } catch (error) {
      if (!warnings.has(path)) {
        warnings.add(path)
        warn(`读取人设数据失败 ${path}：${error.message}`)
      }
      return null
    }
  }

  const base = () => readSafely(mappingFile, () => read(mappingFile, undefined, true))
  const personasDir = resolveFrom(dshHome, textValue(config.personasDir) || textValue(base()?.personasDir) || 'personas')
  const rulesPath = join(personasDir, RULES_FILE)

  function readUserRules() {
    const { path, stat } = checkedPath(personasDir, RULES_FILE)
    const data = read(path, stat, true)
    if (stat && (!data || !Array.isArray(data.rules) || !Array.isArray(data.disabled))) throw new Error('invalid-rules-file')
    return {
      rules: new Map((data?.rules ?? []).map(entry => readRule(entry)).filter(Boolean).map(rule => [rule.id, rule])),
      disabled: new Set((data?.disabled ?? []).filter(item => typeof item === 'string')),
      exists: stat !== null,
    }
  }

  function rulesState(forWrite = false) {
    const builtin = readBaseRules(base()?.rules)
    const user = forWrite ? readUserRules() : readSafely(rulesPath, readUserRules)
    return { builtin, ...(user ?? { rules: new Map(), disabled: new Set(), exists: existsSync(rulesPath) }) }
  }

  function effectiveRules({ builtin, rules, disabled }) {
    const merged = new Map(builtin)
    for (const [id, rule] of rules) merged.set(id, rule)
    return [...merged.values()].map(rule => ({
      ...rule,
      enabled: rule.enabled && !disabled.has(rule.id),
      source: rules.has(rule.id) ? (builtin.has(rule.id) ? 'override' : 'custom') : 'builtin',
    }))
  }

  function loadPersona(root, persona) {
    return readSafely(join(root, persona), () => {
      const { path, stat } = checkedPath(root, persona)
      return read(path, stat)
    })
  }

  function personaData(persona) {
    const user = loadPersona(personasDir, persona)
    const builtin = loadPersona(defaultPersonasDir, persona)
    return {
      personaSource: user !== null ? 'user' : builtin !== null ? 'builtin' : 'missing',
      content: user ?? builtin ?? '',
      hasBuiltinPersona: builtin !== null,
      hasUserPersona: user !== null,
    }
  }

  function writablePath(filename) {
    const { path, stat } = checkedPath(personasDir, filename)
    const target = canonical(path)
    if ([DEFAULT_DIR, defaultPersonasDir].some(root => contains(canonical(root), target)) ||
        [defaultMappingFile, mappingFile].some(file => contains(canonical(file), target)) ||
        (filename !== RULES_FILE && contains(canonical(rulesPath), target))) {
      throw new InputError('unsafe-path')
    }
    return { path, stat }
  }

  function write(path, content) {
    if (content === null) {
      rmSync(path, { force: true })
    } else {
      // 同目录原子替换，避免读取到半份 JSON，也不会就地改写硬链接指向的文件。
      mkdirSync(dirname(path), { recursive: true })
      const temp = join(dirname(path), `.model-persona-${randomUUID()}.tmp`)
      try {
        writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
        renameSync(temp, path)
      } finally {
        rmSync(temp, { force: true })
      }
    }
    cache.delete(path)
  }

  function persist({ rules, disabled }, updatePersona) {
    const { path, stat } = writablePath(RULES_FILE)
    const next = rules.size || disabled.size
      ? `${JSON.stringify({ rules: [...rules.values()], disabled: [...disabled] }, null, 2)}\n`
      : null
    const previous = read(path, stat)
    if (updatePersona) write(updatePersona.path, updatePersona.content)
    try {
      if (next !== previous) write(path, next)
    } catch (error) {
      if (updatePersona) write(updatePersona.path, updatePersona.previous)
      throw error
    }
  }

  const status = () => {
    const state = rulesState()
    return {
      personasDir,
      hasUserRulesFile: state.exists,
      rules: effectiveRules(state).map(rule => ({ ...rule, ...personaData(rule.persona) })),
    }
  }

  function findMatch(model) {
    const rules = effectiveRules(rulesState())
    const hit = selectBestRule(model, rules.map(rule => rule.source === 'builtin' ? rule : { ...rule, source: 'user' }))
    if (!hit) return null
    return { ...hit, rule: rules.find(rule => rule.id === hit.rule.id) }
  }

  function match(model) {
    const hit = findMatch(model)
    return hit ? { ...hit, ...personaData(hit.rule.persona) } : null
  }

  function promptText(model) {
    const persona = findMatch(model)?.rule.persona
    if (!persona) return ''
    return (loadPersona(personasDir, persona) ?? loadPersona(defaultPersonasDir, persona) ?? '').trim()
  }

  function saveRule(body) {
    const id = textValue(body?.id)
    const originalId = body?.originalId === undefined ? id : textValue(body.originalId)
    const patterns = Array.isArray(body?.match) ? body.match : [body?.match]
    if (!validId(id) || !validId(originalId) || !patterns.length || !patterns.every(textValue) ||
        ['name', 'nameEn', 'content'].some(key => body[key] !== undefined && typeof body[key] !== 'string') ||
        (body.enabled !== undefined && typeof body.enabled !== 'boolean')) throw new InputError('bad-request')
    const persona = normalizePersona(body.persona)
    const state = rulesState(true)
    const { builtin, rules, disabled } = state
    const old = rules.get(originalId) ?? builtin.get(originalId)
    if (originalId !== id && (!old || rules.has(id) || builtin.has(id))) throw new InputError('rule-conflict')
    const defaults = builtin.get(id)
    const name = textValue(body.name) || old?.name || id
    const nameEn = textValue(body.nameEn) || (name === defaults?.name ? defaults.nameEn : name === old?.name ? old.nameEn : name)
    const enabled = body.enabled ?? ((old?.enabled ?? true) && !disabled.has(originalId))
    const rule = { id, name, nameEn, match: normalizeMatch(patterns), persona, enabled }

    if (originalId !== id) {
      rules.delete(originalId)
      // 改名产生独立规则，旧内置项停用后仍能从列表恢复。
      if (builtin.has(originalId)) disabled.add(originalId)
      else disabled.delete(originalId)
    }
    disabled.delete(id)
    const sameFields = defaults && sameRule(rule, defaults)
    if (!enabled && (!sameFields || defaults.enabled)) disabled.add(id)
    if (sameFields && !(enabled && !defaults.enabled)) rules.delete(id)
    else rules.set(id, { ...rule, enabled: true })

    const destination = writablePath(persona)
    const content = body.content
    const effective = personaData(persona).content
    const normalizeLines = value => value.replaceAll('\r\n', '\n')
    const updatePersona = textValue(content) && normalizeLines(content) !== normalizeLines(effective)
      ? { ...destination, previous: read(destination.path, destination.stat), content }
      : null
    persist(state, updatePersona)
  }

  function deleteRule(body) {
    const id = textValue(body?.id)
    if (!validId(id) || (body.deleteFile !== undefined && typeof body.deleteFile !== 'boolean')) {
      throw new InputError('bad-request')
    }
    const state = rulesState(true)
    const rule = state.rules.get(id) ?? state.builtin.get(id)
    if (!rule) throw new InputError('unknown-rule')
    state.rules.delete(id)
    state.disabled.delete(id)
    const file = body.deleteFile ? writablePath(rule.persona) : null
    persist(state, file?.stat ? { ...file, previous: read(file.path, file.stat), content: null } : null)
  }

  function resetPersona(persona) {
    const { path, stat } = writablePath(normalizePersona(persona))
    if (stat) write(path, null)
  }

  function resetRules() {
    const { path, stat } = writablePath(RULES_FILE)
    if (stat) write(path, null)
  }

  return { status, match, promptText, saveRule, deleteRule, resetPersona, resetRules }
}

export function modelOf(context) {
  const fixed = textValue(context?.modelSelection?.model)
  if (fixed) return fixed
  const agent = context?.agent
  try {
    const live = textValue(agent?.model?.current?.()?.model)
    if (live) return live
  } catch {
    // 会话初始化期间读取不到实时选择时，沿用创建会话时的模型。
  }
  return textValue(agent?.options?.model) || textValue(context?.variables?.model)
}

function whenReady(ctx, service, setup) {
  if (typeof ctx.inject === 'function') {
    ctx.inject([service], scope => {
      const target = scope.get?.(service) ?? scope[service]
      if (target) setup(target, scope)
    })
    return
  }
  const target = ctx.get?.(service)
  if (target) setup(target, ctx)
}

export function apply(ctx, config = {}) {
  const homePath = ctx.get?.('dshHomePath')
  const dshHome = typeof homePath === 'function' ? homePath() : (textValue(process.env.DSH_HOME) || join(homedir(), '.dsh'))
  const warn = message => ctx.logger?.warn?.(message)
  const store = createStore(dshHome, config, warn)

  ctx.effect(() => ctx.systemPrompt.section({
    name: textValue(config.sectionName) || name,
    order: Number.isFinite(config.order) ? config.order : 0,
    interpolate: false,
    text: context => {
      const model = modelOf(context)
      return model ? store.promptText(model) : ''
    },
  }), 'model-persona.section()')

  whenReady(ctx, 'connection', (connection, scope) => {
    const headers = { 'cache-control': 'no-store' }
    const register = (path, method, handle, needsBody = method === 'POST') => scope.effect(() => connection.fetch.register({
      path: `${API}${path}`,
      methods: [method],
      requestBody: 'buffered',
      fetch: async request => {
        let body
        if (needsBody) {
          try {
            body = await request.json()
          } catch {
            return Response.json({ ok: false, error: 'bad-request' }, { status: 400, headers })
          }
        }
        try {
          return Response.json(handle(body), { headers })
        } catch (error) {
          const invalid = error instanceof InputError
          if (!invalid) warn(`人设接口 ${path} 执行失败：${error.message}`)
          return Response.json({ ok: false, error: invalid ? error.message : 'storage-error' }, { status: invalid ? 400 : 500, headers })
        }
      },
    }), `model-persona: ${path}`)

    const change = update => body => {
      update(body)
      return { ok: true, status: store.status() }
    }
    register('/status', 'GET', store.status)
    register('/test', 'POST', body => {
      const model = textValue(body?.model)
      if (!model) throw new InputError('bad-request')
      return { ok: true, match: store.match(model) }
    })
    register('/rule/save', 'POST', change(store.saveRule))
    register('/rule/delete', 'POST', change(store.deleteRule))
    register('/persona/reset', 'POST', change(body => store.resetPersona(body?.persona)))
    register('/reset-rules', 'POST', change(store.resetRules), false)
  })

  whenReady(ctx, 'commands', (commands, scope) => scope.effect(() => commands.register({
    name: 'model-persona-clear',
    description: '清除规则配置并恢复默认规则 / Clear rule settings and restore defaults',
    recordInput: false,
    handler: async () => {
      store.resetRules()
      return {
        kind: 'success',
        text: '已恢复默认规则，个人 Markdown 人设文件已保留。\nDefault rules restored. Personal Markdown persona files were kept.',
      }
    },
  })))
}

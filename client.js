window.__ModuleLoader__.load({
  id: 'dsh-model-persona',
  factory(require) {
    const React = require('react')
    const element = React.createElement
    const PKG = 'dsh-model-persona'
    const NS = 'model-persona'
    const API = 'api/dsh-model-persona'
    const DICT = {
      zh: {
        language: 'zh', title: '模型人设', testTitle: '测试模型匹配', modelId: '模型 ID', test: '测试',
        noMatch: '没有匹配到已启用的规则。', score: '匹配分值', keyword: '命中关键词',
        ruleSource: '规则来源', personaSource: '正文来源', preview: '预览人设正文',
        rules: '人设规则', newRule: '+ 新增版本/自定义规则', edit: '编辑', enabled: '启用',
        resetRule: '恢复默认规则', resetPersona: '恢复包内默认正文', resetAll: '恢复全部默认规则',
        resetAllConfirm: '确认清除自定义规则？', resetPersonaConfirm: '确认恢复默认正文？',
        deleteRule: '删除规则', deleteConfirm: '确认删除规则？', confirmYes: '确认',
        builtin: '包内默认', override: '本地覆盖', custom: '自定义规则', user: '本地覆盖', missing: '缺少正文',
        id: '规则 ID', displayName: '显示名', patterns: '匹配关键词（逗号分隔）',
        filename: '人设文件名', content: '人设 Markdown 正文',
        save: '保存', cancel: '取消', saved: '已保存，下一次组装系统提示词时生效。',
        loading: '正在读取…', retry: '重试', failed: '操作失败', empty: '暂无规则。',
        'bad-request': '请填写有效的规则 ID、匹配关键词和文件名。',
        'invalid-persona': '请填写安全的相对人设文件名，例如 gpt-6.2-sol.md。',
        'unsafe-path': '路径不可写或指向人设目录以外。',
        'rule-conflict': '规则 ID 已被占用，或原规则已删除。',
        'unknown-rule': '找不到这条规则。', 'storage-error': '无法读取或写入人设文件，请检查 DSH 日志。',
      },
      en: {
        language: 'en', title: 'Model Personas', testTitle: 'Test a model match', modelId: 'Model ID', test: 'Test',
        noMatch: 'No enabled rule matches this model.', score: 'Score', keyword: 'Matched keyword',
        ruleSource: 'Rule source', personaSource: 'Persona source', preview: 'Preview persona text',
        rules: 'Persona rules', newRule: '+ Add version or custom rule', edit: 'Edit', enabled: 'Enabled',
        resetRule: 'Restore default rule', resetPersona: 'Restore built-in text', resetAll: 'Restore all default rules',
        resetAllConfirm: 'Clear custom rules?', resetPersonaConfirm: 'Restore built-in text?',
        deleteRule: 'Delete rule', deleteConfirm: 'Delete this custom rule?', confirmYes: 'Confirm',
        builtin: 'Built-in', override: 'Local override', custom: 'Custom rule', user: 'Local override', missing: 'Text missing',
        id: 'Rule ID', displayName: 'Display name', patterns: 'Match keywords (comma-separated)',
        filename: 'Persona filename', content: 'Persona Markdown text',
        save: 'Save', cancel: 'Cancel', saved: 'Saved. Changes apply the next time the system prompt is assembled.',
        loading: 'Loading…', retry: 'Retry', failed: 'Could not complete the operation', empty: 'No rules yet.',
        'bad-request': 'Enter a valid rule ID, match keywords, and filename.',
        'invalid-persona': 'Enter a safe relative filename, such as gpt-6.2-sol.md.',
        'unsafe-path': 'The path is not writable or points outside the persona folder.',
        'rule-conflict': 'The rule ID is in use, or the original rule has been deleted.',
        'unknown-rule': 'The rule was not found.', 'storage-error': 'Could not read or write persona files. Check the DSH log.',
      },
    }

    // 对照页面基址构造 Host 请求，兼容 DSH 挂载在子路径的部署。
    async function request(path, signal, body) {
      const options = { credentials: 'same-origin', cache: 'no-store', signal }
      if (body !== undefined) {
        options.method = 'POST'
        options.headers = { 'content-type': 'application/json' }
        options.body = JSON.stringify(body)
      }
      const response = await fetch(new URL(`${API}${path}`, document.baseURI).href, options)
      const result = await response.json().catch(() => null)
      if (!response.ok || !result || result.ok === false) throw new Error(result?.error ?? `HTTP ${response.status}`)
      return result
    }

    const CSS = `
.mp-root { display:grid; gap:12px; width:100%; max-width:760px; color:var(--dsw-alias-label-primary); }
.mp-card, .mp-editor { display:grid; gap:12px; padding:16px 18px; border:1px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l2)); border-radius:var(--dsw-radius-xl, 12px); background:var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2)); min-width:0; }
.mp-editor { padding:12px; background:var(--dsw-alias-bg-layer-1); }
.mp-title { margin:0; font-size:15px; font-weight:600; line-height:22px; }
.mp-row, .mp-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
.mp-row { justify-content:space-between; gap:8px 12px; }
.mp-rule { display:grid; gap:10px; padding-top:12px; border-top:1px solid var(--dsw-alias-border-l2); }
.mp-info { flex:1 1 200px; min-width:0; overflow-wrap:anywhere; }
.mp-name { font-size:14px; font-weight:550; }
.mp-badge { border:1px solid var(--dsw-alias-border-l2); border-radius:999px; padding:1px 7px; color:var(--dsw-alias-label-secondary); font-size:11px; }
.mp-badge[data-source="override"], .mp-badge[data-source="user"], .mp-badge[data-source="custom"] { color:var(--dsw-alias-brand-primary); }
.mp-hint { margin:0; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; overflow-wrap:anywhere; }
.mp-root button, .mp-root input, .mp-root textarea { box-sizing:border-box; min-height:32px; border-radius:var(--dsw-radius-md, 8px); border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1); color:inherit; font:inherit; font-size:13px; padding:5px 10px; }
.mp-root input, .mp-root textarea { min-width:0; width:100%; }
.mp-test-input { flex:1 1 180px; }
.mp-root textarea { resize:vertical; min-height:152px; font-family:monospace; }
.mp-root button, .mp-root summary { cursor:pointer; }
.mp-root button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.mp-root button:disabled { opacity:.55; cursor:default; }
.mp-root :is(button, input, textarea, summary):focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
.mp-root .mp-primary { color:var(--dsw-alias-brand-primary); }
.mp-root .mp-switch { position:relative; flex:none; width:36px; min-height:20px; border:0; border-radius:999px; padding:0; background:var(--dsw-alias-state-idle-primary); }
.mp-root .mp-switch[aria-checked="true"] { background:var(--dsw-alias-brand-primary); }
.mp-switch::after { position:absolute; content:''; width:16px; height:16px; top:2px; left:2px; border-radius:50%; background:var(--dsw-alias-bg-layer-1); transition:transform .15s; }
.mp-switch[aria-checked="true"]::after { transform:translateX(16px); }
.mp-fields { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap:10px; }
.mp-field { display:grid; gap:4px; }
.mp-result { display:grid; gap:6px; font-size:13px; overflow-wrap:anywhere; }
.mp-result pre { max-height:280px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; padding:8px; background:var(--dsw-alias-bg-layer-1); border-radius:var(--dsw-radius-md, 8px); }
.mp-error { color:var(--dsw-alias-state-error-primary); }
`

    const titleFor = (rule, locale) => locale === 'en' ? rule.nameEn : rule.name
    const draftFor = rule => ({
      id: rule?.id ?? '', name: rule?.name ?? '', nameEn: rule?.nameEn ?? '', match: rule?.match.join(', ') ?? '',
      persona: rule?.persona ?? '', content: rule?.content ?? '',
    })
    const rulePayload = ({ id, name, nameEn, match, persona, enabled }) => ({ id, name, nameEn, match, persona, enabled })

    function SettingsPanel({ t, localeStore, withTitle }) {
      const [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [saved, setSaved] = React.useState(false)
      const [model, setModel] = React.useState('')
      const [result, setResult] = React.useState(null)
      const [editor, setEditor] = React.useState(null)
      const [confirmKey, setConfirmKey] = React.useState('')
      const life = React.useRef(null)
      const pending = React.useRef(false)
      React.useSyncExternalStore(localeStore.subscribe, localeStore.getSnapshot)
      const locale = t('language')

      React.useEffect(() => {
        const controller = new AbortController()
        life.current = controller
        request('/status', controller.signal).then(
          next => { if (!controller.signal.aborted) setStatus(next) },
          failure => { if (!controller.signal.aborted) setError(failure.message) },
        )
        return () => controller.abort()
      }, [])

      async function run(path, body, onSuccess) {
        if (pending.current) return
        const { signal } = life.current
        pending.current = true
        setConfirmKey('')
        setBusy(true)
        setSaved(false)
        setError('')
        try {
          const next = await request(path, signal, body)
          if (!signal.aborted) onSuccess(next)
        } catch (failure) {
          if (!signal.aborted) setError(failure.message)
        } finally {
          pending.current = false
          if (!signal.aborted) setBusy(false)
        }
      }

      const change = (path, body, after) => run(path, body, next => {
        setStatus(next.status)
        setResult(null)
        setSaved(true)
        after?.(next.status)
      })
      const button = (label, onClick, props = {}) => element('button', { type: 'button', disabled: busy, onClick, ...props }, t(label))
      const open = rule => {
        setConfirmKey('')
        setEditor({ originalId: rule?.id ?? null, draft: draftFor(rule) })
      }
      const confirmButton = (key, label, confirmLabel, action) => confirmKey === key
        ? element('span', { className: 'mp-actions' },
            element('span', { className: 'mp-hint' }, t(confirmLabel)),
            button('confirmYes', action, { className: 'mp-error' }),
            button('cancel', () => setConfirmKey('')),
          )
        : button(label, () => setConfirmKey(key))
      const resetRule = rule => change('/rule/delete', { id: rule.id }, () => {
        if (editor?.originalId === rule.id) setEditor(null)
      })

      function renderEditor(rule) {
        const { draft, originalId } = editor
        const update = key => event => {
          const value = event.target.value
          setEditor(current => ({ ...current, draft: { ...current.draft, [key]: value } }))
        }
        const field = (key, label, props = {}, type = 'input') => element('label', { key, className: 'mp-field' },
          element('span', { className: 'mp-hint' }, t(label)),
          element(type, { value: draft[key], disabled: busy, onChange: update(key), ...props }),
        )
        const sameFile = rule?.persona === draft.persona.trim().replaceAll('\\', '/')
        return element('form', {
          className: 'mp-editor',
          onSubmit: event => {
            event.preventDefault()
            const id = draft.id.trim()
            if (id !== originalId && status.rules.some(candidate => candidate.id === id)) {
              setError('rule-conflict')
              return
            }
            const match = draft.match.split(/[,，]/).map(keyword => keyword.trim()).filter(Boolean)
            const edited = !sameFile || draft.content !== (rule?.content ?? '')
            change('/rule/save', {
              id, name: draft.name || draft.nameEn, nameEn: draft.nameEn, match, persona: draft.persona, enabled: rule?.enabled ?? true,
              ...(originalId && { originalId }),
              ...(edited && { content: draft.content }),
            }, () => setEditor(null))
          },
        },
        element('div', { className: 'mp-fields' },
          field('id', 'id', { required: true, pattern: '[A-Za-z0-9][A-Za-z0-9._\\-]*', placeholder: 'gpt-6.2-sol' }),
          field(locale === 'en' ? 'nameEn' : 'name', 'displayName'),
          field('match', 'patterns', { required: true, placeholder: 'gpt-6.2-sol, gpt-6.2sol' }),
          field('persona', 'filename', { required: true, placeholder: 'gpt-6.2-sol.md' }),
        ),
        field('content', 'content', { rows: 7, spellCheck: false }, 'textarea'),
        element('div', { className: 'mp-actions' },
          button('save', undefined, { type: 'submit', className: 'mp-primary' }),
          button('cancel', () => setEditor(null)),
          sameFile && rule.hasBuiltinPersona && rule.hasUserPersona && confirmButton(
            `persona:${rule.id}`, 'resetPersona', 'resetPersonaConfirm',
            () => change('/persona/reset', { persona: rule.persona }, next => open(next.rules.find(candidate => candidate.id === rule.id))),
          ),
          rule?.source === 'custom' && confirmButton(
            `delete:${rule.id}`, 'deleteRule', 'deleteConfirm', () => resetRule(rule),
          ),
        ))
      }

      function renderRule(rule) {
        const label = titleFor(rule, locale)
        const badge = rule.source === 'custom' ? 'custom'
          : rule.source === 'override' || rule.personaSource === 'user' ? 'override' : rule.personaSource
        const canResetRule = rule.source === 'override' || (rule.source === 'builtin' && !rule.enabled)
        return element('div', { key: rule.id, className: 'mp-rule' },
          element('div', { className: 'mp-row' },
            element('div', { className: 'mp-info' },
              element('div', { className: 'mp-actions' },
                element('span', { className: 'mp-name' }, label),
                element('span', { className: 'mp-badge', 'data-source': badge }, t(badge)),
              ),
              element('p', { className: 'mp-hint', title: rule.match.join(', ') }, rule.match.join(', ')),
            ),
            element('div', { className: 'mp-actions' },
              element('button', {
                type: 'button', role: 'switch', className: 'mp-switch', disabled: busy, 'aria-checked': rule.enabled,
                'aria-label': `${t('enabled')} · ${label}`,
                onClick: () => change('/rule/save', { ...rulePayload(rule), enabled: !rule.enabled }),
              }),
              button('edit', () => open(rule)),
              canResetRule && button('resetRule', () => resetRule(rule)),
            ),
          ),
          editor?.originalId === rule.id && renderEditor(rule),
        )
      }

      const hit = result?.match
      const testPanel = element('div', { className: 'mp-card' },
        element('h3', { className: 'mp-title' }, t('testTitle')),
        element('form', {
          className: 'mp-actions',
          onSubmit: event => {
            event.preventDefault()
            if (model.trim()) void run('/test', { model }, setResult)
          },
        },
        element('input', {
          className: 'mp-test-input', 'aria-label': t('modelId'), placeholder: 'linkapi/[次]gpt-6.2sol',
          value: model, onChange: event => { setModel(event.target.value); setResult(null) }, disabled: busy, required: true,
        }),
        button('test', undefined, { type: 'submit', disabled: busy || !model.trim(), className: 'mp-primary' })),
        result && element('div', { className: 'mp-result', role: 'status' }, hit ? [
          element('strong', { key: 'name' }, titleFor(hit.rule, locale)),
          element('p', { key: 'score', className: 'mp-hint' }, `${t('score')} ${hit.score} · ${t('keyword')} ${hit.matchedPattern}`),
          element('p', { key: 'source', className: 'mp-hint' }, `${t('ruleSource')} ${t(hit.rule.source)} · ${t('personaSource')} ${t(hit.personaSource)}`),
          hit.content && element('details', { key: 'preview' },
            element('summary', null, t('preview')),
            element('pre', null, hit.content),
          ),
        ] : t('noMatch')),
      )

      return element('div', { className: 'mp-root', 'aria-busy': busy },
        element('style', null, CSS),
        withTitle && element('h2', { className: 'mp-title' }, t('title')),
        error && element('div', { className: 'mp-actions' },
          element('p', { className: 'mp-hint mp-error', role: 'alert' },
            `${t('failed')} · ${Object.hasOwn(DICT.en, error) ? t(error) : error}`,
          ),
          !status && button('retry', () => run('/status', undefined, setStatus)),
        ),
        saved && element('p', { className: 'mp-hint', role: 'status' }, t('saved')),
        !status && !error && element('p', { className: 'mp-hint', role: 'status' }, t('loading')),
        status && testPanel,
        status && element('div', { className: 'mp-card' },
          element('div', { className: 'mp-row' },
            element('h3', { className: 'mp-title' }, t('rules')),
            element('div', { className: 'mp-actions' },
              button('newRule', () => open(null), { className: 'mp-primary' }),
              status.hasUserRulesFile && confirmButton(
                'reset-all', 'resetAll', 'resetAllConfirm',
                () => change('/reset-rules', {}, () => setEditor(null)),
              ),
            ),
          ),
          element('p', { className: 'mp-hint', title: status.personasDir }, status.personasDir),
          editor?.originalId === null && renderEditor(null),
          !status.rules.length && element('p', { className: 'mp-hint' }, t('empty')),
          ...status.rules.map(renderRule),
        ),
      )
    }

    function IconPersona({ size = 16 } = {}) {
      return element('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      },
      element('circle', { cx: 6.5, cy: 5, r: 2.2 }),
      element('path', { d: 'M2.5 13v-1.2c0-1.9 1.5-3 4-3 1.1 0 2 .2 2.7.7m2.7-5v4m-2-2h4m-2 4v2.5' }))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        for (const [lang, dict] of Object.entries(DICT)) ctx.effect(() => ctx.locale.register(NS, lang, dict))
        const t = ctx.locale.bind(NS)
        const localeStore = { subscribe: ctx.locale.subscribe.bind(ctx.locale), getSnapshot: ctx.locale.getSnapshot.bind(ctx.locale) }

        // 两个入口复用组件和 Host 状态接口，路由本身由设置面板管理。
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
          { name: 'plugins.bundle.config', key: PKG },
          () => element(SettingsPanel, { t, localeStore, withTitle: false }),
        ))
        ctx.slots.inject('settings.section', () => ctx.slots.register(
          { name: 'settings.section', id: NS, order: 47, locale: NS, label: () => t('title') },
          () => element(SettingsPanel, { t, localeStore, withTitle: true }),
        ))
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register(
          { name: 'settings.section.icon', id: NS }, IconPersona,
        ))
      },
    }
  },
})

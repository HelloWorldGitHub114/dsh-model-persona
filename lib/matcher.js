export function tokenizeAscii(str) {
  return str.toLowerCase().split(/[^a-z0-9]+|(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])/).filter(Boolean)
}

function sliceScore(chars, total, start, end, length) {
  const edgeBonus = (start === 0 ? 20 : 0) + (end === length ? 20 : 0)
  return 1150 + chars * 40 + Math.round(chars / total * 200) + edgeBonus
}

function scorePart(raw, tokens, pattern, needles) {
  const compact = needles.join('')
  const chars = compact.length
  const total = tokens.reduce((sum, token) => sum + token.length, 0)
  let bestSlice = 0
  let bestOrdered = 0

  if (needles.length > 0) {
    for (let start = tokens.indexOf(needles[0]); start !== -1; start = tokens.indexOf(needles[0], start + 1)) {
      let end = start + 1
      let index = 1
      let runStart = start
      let runChars = needles[0].length
      let bestRun = 0
      for (; index < needles.length; index++) {
        const position = tokens.indexOf(needles[index], end)
        if (position === -1 || position - start - index > 4) break
        if (position !== end) {
          bestRun = Math.max(bestRun, sliceScore(runChars, total, runStart, end, tokens.length))
          runStart = position
          runChars = 0
        }
        runChars += needles[index].length
        end = position + 1
      }
      if (index !== needles.length) continue
      if (needles.length === tokens.length) return { score: 2000 + chars * 30, reason: 'exact' }
      const gaps = end - start - needles.length
      if (gaps === 0) {
        bestSlice = Math.max(bestSlice, sliceScore(chars, total, start, end, tokens.length))
      } else {
        const base = 950 + chars * 40 + Math.round(chars / total * 150) - gaps * 20
        bestRun = Math.max(bestRun, sliceScore(runChars, total, runStart, end, tokens.length))
        // 跨词规则至少赢过自身的连续片段，差值覆盖同分时的用户规则加分。
        bestOrdered = Math.max(bestOrdered, base, bestRun + 6)
      }
    }
  }

  if (bestSlice) return { score: bestSlice, reason: 'slice' }
  if (bestOrdered) return { score: bestOrdered, reason: 'ordered' }
  if (chars >= 4 && tokens.join('').includes(compact)) return { score: 800 + chars * 30, reason: 'compact' }
  if (/[^a-z0-9\s._/-]/.test(pattern) && raw.includes(pattern)) {
    return { score: 700 + pattern.length * 25, reason: 'literal' }
  }
  return null
}

export function scorePattern(modelId, pattern) {
  if (typeof modelId !== 'string' || typeof pattern !== 'string' || !pattern.trim()) return null
  const rawPattern = pattern.trim().toLowerCase()
  const needles = tokenizeAscii(rawPattern)
  const separator = modelId.lastIndexOf('/')
  const model = modelId.slice(separator + 1).toLowerCase()
  const hit = scorePart(model, tokenizeAscii(model), rawPattern, needles)
  if (hit) return { ...hit, pattern }
  if (separator === -1) return null

  const provider = modelId.slice(0, separator).toLowerCase()
  const fallback = scorePart(provider, tokenizeAscii(provider), rawPattern, needles)
  if (!fallback) return null
  // 压缩供应商得分，保留区分度，并给模型段命中留出独立的分数区间。
  return { score: 200 + Math.min(299, Math.round(fallback.score / 10)), reason: 'provider', pattern }
}

export function selectBestRule(modelId, rules) {
  let best = null
  for (const rule of rules) {
    if (rule.enabled === false) continue
    for (const pattern of Array.isArray(rule.match) ? rule.match : [rule.match]) {
      const hit = scorePattern(modelId, pattern)
      if (!hit) continue
      const score = hit.score + (rule.source === 'user' ? 5 : 0)
      if (!best || score > best.score) {
        best = { rule, score, matchedPattern: hit.pattern, reason: hit.reason }
      }
    }
  }
  return best
}

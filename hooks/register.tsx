import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Plan } from '../types'

// Bump the tag when Plan's fields change: it declines what an earlier version stored.
const plan = atom({ plugin: 'run-progress', key: 'plan' } as const, null, {
  shape: 'plan-1',
})
// Wall-clock tick (ms) so elapsed time and ETA redraw while a long step runs.
const now = atom({ plugin: 'run-progress', key: 'now' } as const, 0)

const FULL = '█'
const EMPTY = '░'
const PARTIAL = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/** tqdm-style bar of `width` cells for a 0..1 fraction. */
export function bar(fraction: number, width: number): string {
  const f = Math.min(1, Math.max(0, fraction))
  const eighths = Math.round(f * width * 8)
  const full = Math.floor(eighths / 8)
  const part = PARTIAL[eighths % 8]
  return (FULL.repeat(full) + part).padEnd(width, EMPTY).slice(0, width + 1)
}

/** 3725 s -> "1h02m05s", 192 s -> "3m12s", 8 s -> "8s". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m${String(sec).padStart(2, '0')}s`
  if (m > 0) return `${m}m${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

/** Local clock time of an epoch-ms instant; adds the date if it is not today. */
export function clockTime(at: number, nowMs: number): string {
  const d = new Date(at)
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return d.toDateString() === new Date(nowMs).toDateString()
    ? t
    : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${t}`
}

/** Remaining ms from the mean time per completed item; null until one item is done. */
export function etaMs(p: Plan, nowMs: number): number | null {
  if (p.done === 0 || p.total <= p.done) return p.total <= p.done ? 0 : null
  return ((nowMs - p.startedAt) / p.done) * (p.total - p.done)
}

type Dollar = Parameters<Hook<'session.start'>>[0]
type Item = { status: string; content: string }
const OWN_TOOL = 'mcp__run-progress__run_progress'

/** Store a fresh reading of the plan; a finished or shrunk plan starts a new run. */
async function record(
  $: Dollar,
  total: number,
  done: number,
  active: string,
): Promise<void> {
  const t = await $.clock.now()
  await update($, plan, prev => {
    if (total <= 0) return null
    const isNewRun = prev === null || prev.done >= prev.total || done < prev.done
    const startedAt = isNewRun ? t : prev.startedAt
    const before = isNewRun ? 0 : prev.done
    const lastDoneAt = done > before ? t : isNewRun ? 0 : prev.lastDoneAt
    return { total, done, active, startedAt, lastDoneAt }
  })
  await update($, now, () => t)
}

/** Record done/total/active from a list of todo-like items. */
async function fromItems($: Dollar, items: Item[]): Promise<void> {
  await record(
    $,
    items.length,
    items.filter(x => x.status === 'completed').length,
    items.find(x => x.status === 'in_progress')?.content ?? '',
  )
}

/** Re-read TaskList and record its done/total (only when the call succeeded). */
async function syncTasks($: Dollar, isOk: boolean): Promise<void> {
  if (!isOk) return
  const list = await $.tool.call({ tool: 'TaskList' })
  const tasks = (list.result as { tasks?: { subject: string; status: string }[] } | undefined)?.tasks
  if (tasks) {
    await fromItems($, tasks.map(x => ({ status: x.status, content: x.subject })))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(1000, async () => {
      const p = await read($, plan)
      if (p !== null && p.done < p.total) {
        const t = await $.clock.now()
        await update($, now, () => t)
      }
    })
    // A tool the model can call to report progress of any long job
    // (a loop, a SLURM array, a script): done, total and an optional label.
    await $.tool.register({
      name: 'run_progress',
      description:
        'Report progress of a long-running job so the user sees a progress bar, percent and estimated finish time. Call with done/total whenever a unit of work finishes (at most every few seconds). total=0 clears the bar.',
      inputSchema: {
        type: 'object',
        properties: {
          done: { type: 'integer', minimum: 0, description: 'Units finished so far' },
          total: { type: 'integer', minimum: 0, description: 'Total units' },
          label: { type: 'string', description: 'What is running now' },
        },
        required: ['done', 'total'],
      },
      isDeferred: false,
    })
    return next(e)
  })

  on('tool.run', { tool: OWN_TOOL }, async ($, e) => {
    const input = e as unknown as { done?: number; total?: number; label?: string }
    const total = Math.max(0, Math.floor(Number(input.total ?? 0)))
    const done = Math.min(total, Math.max(0, Math.floor(Number(input.done ?? 0))))
    await record($, total, done, input.label ?? '')
    return { result: total === 0 ? 'progress bar cleared' : `progress ${done}/${total} recorded` }
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    await fromItems($, e.todos)
    return next(e)
  })

  // Task tools: after any create/update, read the whole list back.
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    await syncTasks($, ran.deny === undefined && ran.isError !== true)
    return ran
  })
  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    await syncTasks($, ran.deny === undefined && ran.isError !== true)
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await read($, plan)
    if (e.props.hasSurvey || p === null) return next(e)
    const isFinished = p.done >= p.total
    if (!e.props.isWorking) return next(e)

    const t = Math.max(await read($, now), p.startedAt)
    const { Box, Text } = $.ui.resolve(e)
    const pct = Math.floor((p.done / p.total) * 100)
    const width = Math.max(10, Math.min(40, e.props.bodyColumns - 62))
    const eta = etaMs(p, t)
    const tail = isFinished
      ? `done in ${duration(t - p.startedAt)}`
      : eta === null
        ? `elapsed ${duration(t - p.startedAt)} · ETA …`
        : `elapsed ${duration(t - p.startedAt)} · ETA ${clockTime(t + eta, t)} (~${duration(eta)} left)`

    return (
      <Box flexDirection="column">
        <Text>
          <Text color="green">{bar(p.done / p.total, width)}</Text>
          <Text> {String(pct).padStart(3)}% </Text>
          <Text dimColor>
            {p.done}/{p.total} · {tail}
          </Text>
        </Text>
        {p.active !== '' && !isFinished && <Text dimColor>▸ {p.active}</Text>}
      </Box>
    )
  })
}

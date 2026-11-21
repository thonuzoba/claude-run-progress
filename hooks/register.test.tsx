import { expect, test } from 'claude-code/testing'

import { bar, clockTime, duration, etaMs } from './register'

const BAND = {
  plugin: 'run-progress',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: true,
    maxRows: 6,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 5 },
    view: {},
  },
} as const

const todos = (statuses: string[]) =>
  statuses.map((status, i) => ({
    content: `step ${i + 1}`,
    activeForm: `doing step ${i + 1}`,
    status,
  })) as never

test('helpers: bar, duration, eta', () => {
  expect(bar(0.5, 10)).toBe('█████░░░░░')
  expect(bar(1, 10)).toBe('██████████')
  expect(bar(0, 10)).toBe('░░░░░░░░░░')
  expect(duration(192000)).toBe('3m12s')
  expect(duration(3725000)).toBe('1h02m05s')
  const p = { total: 5, done: 2, active: '', startedAt: 0, lastDoneAt: 1 }
  expect(etaMs(p, 600000)).toBe(900000) // 300 s per item × 3 left
  expect(etaMs({ ...p, done: 0 }, 1000)).toBeNull()
  expect(clockTime(new Date(2026, 10, 21, 9, 5).getTime(), new Date(2026, 10, 21, 20, 0).getTime())).toBe('09:05')
})

test('band shows percent, ratio and an ETA from a TodoWrite plan', async ($, on) => {
  let clock = 1_000_000
  on('clock.now', () => ({ value: clock }))
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({
    tool: 'TodoWrite',
    todos: todos(['in_progress', 'pending', 'pending', 'pending', 'pending']),
  })
  clock += 600_000 // 10 min later two items are done
  await $.tool.call({
    tool: 'TodoWrite',
    todos: todos(['completed', 'completed', 'in_progress', 'pending', 'pending']),
  })

  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const row = await ui.find({ type: 'Text', text: /40%/ })
    expect(row?.text).toMatch(/2\/5/)
    expect(row?.text).toMatch(/elapsed 10m00s/)
    expect(row?.text).toMatch(/~15m00s left/)
    await ui.unmount()
  }
})

test('band stays out of the way with no plan or when finished and idle', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /%/ })) ?? null).toBeNull()
  await ui.unmount()
})

test('the run_progress tool drives the band; idle hides it', async ($, on) => {
  let clock = 5_000_000
  on('clock.now', () => ({ value: clock }))
  on('tool.run', () => ({ result: {} }))
  // beneath the band: stands for the engine's row when the band draws nothing
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.tool.run({ tool: 'mcp__run-progress__run_progress', done: 0, total: 8 } as never)
  clock += 120_000
  await $.tool.run({ tool: 'mcp__run-progress__run_progress', done: 2, total: 8, label: 'array 2' } as never)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const row = await ui.find({ type: 'Text', text: /25%/ })
  expect(row?.text).toMatch(/2\/8/)
  expect(row?.text).toMatch(/~6m00s left/)
  await ui.unmount()

  const idle = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: false }, surface: 'terminal' })
  expect((await idle.find({ type: 'Text', text: /%/ })) ?? null).toBeNull()
  await idle.unmount()
})

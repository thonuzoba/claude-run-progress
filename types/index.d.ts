export type Plan = {
  /** Items in the latest TodoWrite list. */
  total: number
  /** Items with status completed. */
  done: number
  /** Content of the in_progress item, '' if none. */
  active: string
  /** ms epoch when this plan was first seen. */
  startedAt: number
  /** ms epoch of the last completion, 0 if none yet. */
  lastDoneAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'run-progress': { plan: Shaped<Plan | null>; now: number }
  }
}

# run-progress

A Claude Code mod that draws a tqdm-style progress bar above the prompt while a long run is working: bar, percent, done/total, elapsed time and the estimated finish time.

```
████████████▌░░░░░░░░░░░░░░░░  40% 2/5 · elapsed 10m00s · ETA 21:47 (~15m00s left)
▸ current step
```

The ETA is the mean time per finished item times the items left, so it appears after the first item is done (until then: `ETA …`). The bar is shown only while a turn is running.

## What drives it

- the `TodoWrite` list (done = items with status `completed`),
- `TaskCreate` / `TaskUpdate` (the task list is read back after each call),
- its own tool `mcp__run-progress__run_progress({ done, total, label })`, which Claude can call for any long job (a loop, a job array, a script). `total = 0` clears the bar.

A single long command with no countable units gets no bar unless Claude reports units through `run_progress`.

## Install

At the prompt of a terminal session:

```
/plugin install run-progress --marketplace thonuzoba/claude-run-progress
```

From a shell:

```
claude plugin install run-progress --marketplace thonuzoba/claude-run-progress
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `thonuzoba/claude-run-progress`, then Add plugin.

## Develop

```
claude plugin validate .
claude plugin test .
```

License: MIT.

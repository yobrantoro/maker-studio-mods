# Script Bridge

Teaches the **Game Simulator** a set of common Ruby one-liners, and marks in the
editor which Script commands it can actually run.

The simulator has no Ruby, so a Script command is normally logged and skipped —
your cutscene stops behaving halfway through the preview. This mod fills that in
for the calls people write most, and uses the editor UI to make the coverage
visible instead of something you find out by testing.

## What it does

**In the simulator**

| Script | Effect |
|--------|--------|
| `$game_switches[3] = true` | Sets the switch |
| `$game_variables[10] = 5` | Sets the variable |
| `$game_self_switches[[@map_id, @event_id, "A"]] = true` | Sets the self switch (explicit event ids work too) |
| `pbMessage("Hi")` / `pbMessage(_INTL("Hi"))` | Shows a message box |
| `@through = true` / `@transparent = false` | On a **move-route** Script, applies to the character running the route |
| `$game_switches[3]` | As a **Script conditional branch**: the branch answer |
| `$game_variables[10] >= 5` | Same, with `== != >= <= > <` |

Plus **Change Gold (125)**, which the simulator only logs because it has no
party: the mod mirrors it into variable `50` (`GOLD_VARIABLE` at the top of
`index.js`), so a Conditional Branch on that variable behaves in the preview.

**In the editor**

- Every **Script** row in an event's command list gets a small marker: green `▶`
  when this mod can run it in the simulator, grey `·` when it will just be
  logged. Hover for the reason.
- The **Script** command form grows a row of snippet buttons that write a
  supported line into the field.

## API used

### `ctx.simulator` — running the script

```js
ctx.simulator.registerScriptHandler(undefined, (script, sim) => {
  const hit = matchScript(script);
  if (!hit) return null;                    // DECLINE — never swallow what you can't run
  const out = hit.entry.run(hit.m, sim);
  return typeof out === "boolean" ? out : undefined;
});
```

The same handler is offered the Script command (355), a move-route Script (move
code 45) and a Script conditional branch — which is why one table covers all
three. Return values:

- `null` — declined. The next handler, then the built-in "unsupported" log, gets
  its turn. **This is the important one**: a handler that returns `undefined` for
  a script it didn't understand silently eats it, and the log stops telling the
  user that the script never ran.
- `true` / `false` — the answer for a Script conditional branch. On a plain
  Script command it just counts as handled.
- anything else — handled.

The `match` argument (first parameter) is a cheaper filter when you only care
about one prefix: a string matches scripts *starting* with it, a RegExp is tested
against the whole body, a predicate does what you want. This mod passes
`undefined` (see everything) because it keeps its patterns in one table.

```js
ctx.simulator.registerCommandHandler(125, (params, sim) => { ... });
```

Command handlers run **before** the built-in implementation, so this both fills
in a command the simulator lacks and could override one it has. Return `false` to
decline.

### `ctx.ui.decorate` — badging rows that come and go

```js
ctx.ui.decorate(".ee-cmd-row.ee-cmd-script:not(.ee-cmd-cont)", (row) => {
  const badge = document.createElement("span");
  row.prepend(badge);
  // …
  return () => badge.remove();
});
```

Command rows are created and destroyed constantly — scrolling, editing,
switching events — and there is no extension point on them. `decorate` matches
the ones on screen **and every one mounted later**, so this needs no cooperation
from the editor.

Two things the example is deliberate about:

- **The callback runs once per element.** React reuses the same row `<div>` when
  the command is edited, so the badge would go stale. The mod attaches its own
  small `MutationObserver` to the label and disconnects it in the cleanup.
- **The returned cleanup** runs when the row leaves the DOM *or* when the mod
  unloads. Everything appended is removed there.

Selector note: `.ee-cmd-row` / `.ee-cmd-script` are **internal** class names and
can change between releases. `[data-ms-part]` (`dialog`, `menubar`, `toolbar`,
`statusbar`, `panel-header`, `canvas`) is the stable contract; anything else is a
trade-off you are making on purpose.

### `ctx.ui.registerSlot` — buttons that need a setter

```js
ctx.ui.registerSlot("event.command.form.355", (host, slot) => {
  btn.onclick = () => {
    const data = slot.data();                        // getter, not a snapshot
    data.setParameter(0, `${data.parameters[0] ?? ""}\n${snippet}`);
  };
  host.appendChild(bar);
  return () => bar.remove();
});
```

A slot rather than a decorator, because the payload carries `setParameter` — no
amount of DOM poking gets you a handle on the command being edited. `slot.data()`
is a **getter**: one host element is reused across re-renders, so read it at
click time.

## Try it

1. Copy this folder into `%APPDATA%/maker-studio/Mods/` (or your project's
   `Plugins/MakerStudio/003_Editor/Mods/`) and rescan in the Mod Manager.
2. Open any event, add a **Script** command, and click one of the *Script Bridge*
   buttons under the field.
3. Back in the command list, the row shows a green `▶`.
4. Run the Game Simulator on that event page and watch the log: the script runs
   instead of being reported as unsupported.

Then add a script the mod does **not** know (`pbTrainerBattle(...)`): grey `·` in
the list, and the simulator still logs it as unsupported — declining is what
keeps that honest.

## Extending it

Add an entry to `SCRIPTS` in `index.js`:

```js
{
  label: "pbHealAll",
  re: /^pbHealAll\s*$/,
  run: (m, sim) => sim.log("party healed"),
},
```

`label` is both the button caption and the tooltip, and the mod checks its own
snippets against its own patterns — so a button can never insert something the
handler rejects.

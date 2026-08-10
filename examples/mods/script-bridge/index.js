/**
 * Script Bridge — teaches the Game Simulator a set of common Ruby one-liners,
 * and shows in the editor which Script commands it can actually run.
 *
 * Demonstrates:
 *   - ctx.simulator.registerScriptHandler   (Script command 355, move-route
 *                                            Script 45, Script conditional branch)
 *   - ctx.simulator.registerCommandHandler  (implements Change Gold, which the
 *                                            simulator only logs)
 *   - ctx.ui.decorate                       (badge every Script row in the
 *                                            command list — rows come and go, so
 *                                            there is no fixed slot for them)
 *   - ctx.ui.registerSlot                   (buttons in the Script command form
 *                                            that write a snippet into the field)
 *
 * The simulator has no Ruby. Everything below is a deliberate, tiny
 * approximation of what these calls do in-game — enough to make a cutscene
 * behave in the preview, not an interpreter.
 */

/** The simulator has no party gold, so Change Gold is mirrored into this
 *  variable. Conditional branches on the same variable then work in the sim. */
const GOLD_VARIABLE = 50;

// ── The scripts this mod can run ─────────────────────────────────────────────
//
// Each entry is a pattern plus what it does with the captures. `run` returns a
// boolean when the script is also meaningful as a *condition* (a Script
// conditional branch asks the same handler, and the boolean is its answer).

const SCRIPTS = [
  {
    label: "$game_switches[1] = true",
    re: /^\$game_switches\[\s*(\d+)\s*\]\s*=\s*(true|false)\s*$/,
    run: (m, sim) => sim.setSwitch(Number(m[1]), m[2] === "true"),
  },
  {
    label: "$game_variables[1] = 0",
    re: /^\$game_variables\[\s*(\d+)\s*\]\s*=\s*(-?\d+)\s*$/,
    run: (m, sim) => sim.setVariable(Number(m[1]), Number(m[2])),
  },
  {
    // Self switches are keyed [map_id, event_id, "A"]; the sim resolves the map
    // itself, so only the event id and the letter matter here.
    label: '$game_self_switches[[@map_id, @event_id, "A"]] = true',
    re: /^\$game_self_switches\[\[\s*[^,]+,\s*([^,\]]+),\s*["'](\w)["']\s*\]\]\s*=\s*(true|false)\s*$/,
    run: (m, sim) => {
      const raw = m[1].trim();
      const eventId = /^\d+$/.test(raw) ? Number(raw) : (sim.eventId ?? 0);
      sim.setSelfSwitch(m[2], m[3] === "true", eventId);
    },
  },
  {
    label: 'pbMessage(_INTL("Hello!"))',
    re: /^pbMessage\(\s*(?:_INTL\()?\s*["']([\s\S]*?)["']\s*\)?\s*\)\s*$/,
    run: (m, sim) => sim.showText([m[1]]),
  },
  {
    // Move-route Script. `@through`/`@transparent` address the character the
    // route is running on, which is `character(0)` for the handler.
    label: "@through = true   (move route)",
    re: /^@(through|transparent)\s*=\s*(true|false)\s*$/,
    run: (m, sim) => {
      const who = sim.character(0);
      if (!who) return;
      const on = m[2] === "true";
      if (m[1] === "through") who.setThrough(on); else who.setTransparent(on);
    },
  },

  // ── Conditions (a Script conditional branch uses the returned boolean) ──
  {
    label: "$game_switches[1]   (condition)",
    re: /^\$game_switches\[\s*(\d+)\s*\]\s*$/,
    run: (m, sim) => sim.getSwitch(Number(m[1])),
  },
  {
    label: "$game_variables[1] >= 0   (condition)",
    re: /^\$game_variables\[\s*(\d+)\s*\]\s*(==|!=|>=|<=|>|<)\s*(-?\d+)\s*$/,
    run: (m, sim) => {
      const v = sim.getVariable(Number(m[1]));
      const n = Number(m[3]);
      switch (m[2]) {
        case "==": return v === n;
        case "!=": return v !== n;
        case ">=": return v >= n;
        case "<=": return v <= n;
        case ">": return v > n;
        default: return v < n;
      }
    },
  },
];

/** First pattern that matches, or null. Used by the handler AND by the editor
 *  badge, so the two can never disagree about what is supported. */
function matchScript(script) {
  const text = String(script ?? "").trim();
  for (const entry of SCRIPTS) {
    const m = entry.re.exec(text);
    if (m) return { entry, m };
  }
  return null;
}

export function activate(ctx) {
  const missing = [];
  if (!ctx.simulator) missing.push("ctx.simulator");
  if (!ctx.ui.decorate) missing.push("ctx.ui.decorate");
  if (!ctx.ui.registerSlot) missing.push("ctx.ui.registerSlot");
  if (missing.length) {
    ctx.log.warn(`This editor build is missing ${missing.join(", ")}; update Maker Studio.`);
    ctx.ui.showToast({ message: "Script Bridge needs a newer Maker Studio build", level: "warn" });
    return;
  }

  registerSimulator(ctx);
  badgeScriptRows(ctx);
  addSnippetButtons(ctx);

  ctx.log.info(`Script Bridge ready — ${SCRIPTS.length} patterns`);
}

// ── ctx.simulator ────────────────────────────────────────────────────────────

function registerSimulator(ctx) {
  // No `match` argument: every script reaches the handler and it decides. The
  // alternative is one registration per pattern — either works, but a single
  // handler keeps "what do we support" in one list.
  ctx.simulator.registerScriptHandler(undefined, (script, sim) => {
    const hit = matchScript(script);
    // Returning null DECLINES: the next handler, then the built-in
    // "unsupported" log, gets its turn. Never swallow what you can't run.
    if (!hit) return null;
    const out = hit.entry.run(hit.m, sim);
    sim.log(`ran ${hit.entry.label.split("  ")[0]}`);
    // A boolean is the answer for a Script conditional branch; for a plain
    // Script command it just counts as handled.
    return typeof out === "boolean" ? out : undefined;
  });

  // Change Gold (125) — the simulator logs it and moves on, because it has no
  // party. Mirroring it into a variable is enough for the rest of the event
  // (conditional branches, Show Text) to behave.
  //   parameters: [0 = increase | 1 = decrease, 0 = constant | 1 = variable, value]
  ctx.simulator.registerCommandHandler(125, (params, sim) => {
    const decrease = params[0] === 1;
    const amount = params[1] === 1 ? sim.getVariable(Number(params[2]) || 0) : Number(params[2]) || 0;
    const gold = sim.getVariable(GOLD_VARIABLE) + (decrease ? -amount : amount);
    sim.setVariable(GOLD_VARIABLE, Math.max(0, gold));
    sim.log(`gold ${decrease ? "-" : "+"}${amount} → ${Math.max(0, gold)} (variable ${GOLD_VARIABLE})`);
  });
}

// ── ctx.ui.decorate — badge Script rows in the event command list ─────────────

function badgeScriptRows(ctx) {
  // Command rows are created and destroyed constantly (scrolling, editing,
  // switching events), and there is no extension point on them — exactly what
  // `decorate` is for. Continuation rows (`.ee-cmd-cont`) are extra lines of a
  // script above, so only the parent row is badged.
  ctx.ui.decorate(".ee-cmd-row.ee-cmd-script:not(.ee-cmd-cont)", (row) => {
    const badge = document.createElement("span");
    badge.className = "sb-badge";
    badge.style.cssText =
      "flex:0 0 auto;margin-right:4px;font-size:10px;line-height:1;opacity:.85;cursor:default";
    row.prepend(badge);

    const label = row.querySelector(".ee-cmd-name");
    const refresh = () => {
      // The row label is "@><Script>: <first line>" — everything up to the
      // first ": " is the command name, which is localized.
      const text = (label?.textContent ?? "").replace(/^@>[^:]*:\s*/, "");
      const hit = matchScript(text);
      badge.textContent = hit ? "▶" : "·";
      badge.style.color = hit ? "var(--success, #4ec9b0)" : "var(--text-tertiary, #888)";
      badge.title = hit
        ? `Script Bridge runs this in the simulator: ${hit.entry.label}`
        : "Script Bridge can't run this one — the simulator will log it";
    };
    refresh();

    // `decorate` runs ONCE per element. React reuses this same row div when the
    // command is edited, so watch the label yourself if its content matters.
    const watch = new MutationObserver(refresh);
    if (label) watch.observe(label, { childList: true, subtree: true, characterData: true });

    // The cleanup runs when the row leaves the DOM or the mod unloads.
    return () => { watch.disconnect(); badge.remove(); };
  });
}

// ── ctx.ui.registerSlot — snippet buttons in the Script command form ──────────

function addSnippetButtons(ctx) {
  // A slot, not a decorator: the payload carries `setParameter`, which no
  // amount of DOM poking would give us. 355 is the Script command.
  ctx.ui.registerSlot("event.command.form.355", (host, slot) => {
    const bar = document.createElement("div");
    bar.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-top:8px";

    const title = document.createElement("span");
    title.textContent = "Script Bridge:";
    title.style.cssText = "font-size:12px;color:var(--text-secondary, #a0a0b0);align-self:center";
    bar.appendChild(title);

    for (const entry of SCRIPTS) {
      const snippet = entry.label.split("  ")[0];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = snippet;
      btn.title = "Insert this snippet — the simulator can run it";
      btn.style.cssText = "font-size:11px;font-family:monospace;padding:2px 6px";
      btn.onclick = () => {
        // data() is a GETTER: the host element is reused across re-renders, so
        // reading it at click time is the only way to see the current command.
        const data = slot.data();
        const current = String(data.parameters?.[0] ?? "");
        data.setParameter(0, current ? `${current}\n${snippet}` : snippet);
      };
      bar.appendChild(btn);
    }

    host.appendChild(bar);
    return () => bar.remove();
  });
}

// Every registration returns a Disposable tracked by the mod's cleanup bag, so
// all of it is removed automatically on unload — no deactivate() needed.

# jsgui3 Framework Gap & Defect Handling Guide

This guide explains how to document missing capabilities or defects discovered while working with the jsgui3 ecosystem in this workspace. Follow these instructions whenever the framework (as delivered under `node_modules/`) does not provide the behaviour you need. **Do not modify files directly inside `node_modules`.** Instead, build a clear, reproducible report so maintainers or future agents can act upstream.

The jsgui3 stack currently includes the packages verified in `node_modules/`:

- `jsgui3-html` (HTML/SVG control system; see `package.json` version)
- `jsgui3-client` (client runtime/activation helpers)
- `jsgui3-server` (server delivery, bundling, HTTP utilities)
- `lang-tools` (core utilities: `Data_Object`, `Evented_Class`, iterators)
- `jsgui3-gfx-core` (vector/SVG support)
- `fnl` (functional helpers, `prom_or_cb`)

Always confirm the files you reference with `list_dir`, `search`, or `read_file` before citing them.

---

## 1. Discovery Workflow

1. **Observe the Gap**
   - Identify the missing feature or incorrect behaviour.
   - Note where it manifests (control code, binding, parse-mount, server bundling, activation, etc.).

2. **Find the Relevant Modules**
   - `jsgui3-html/html-core/` – core control classes (`control-core.js`, `control.js`, `Data_Model_View_Model_Control.js`), binding (`ModelBinder.js`, `Transformations.js`), templating (`parse-mount.js`).
   - `jsgui3-html/controls/` – reference controls, composition patterns, vector examples.
   - `jsgui3-html/control_mixins/` – behaviour mixins (drag, selectable, popup, etc.).
   - `jsgui3-html/examples/` – runnable samples to compare expected behaviour.
   - `jsgui3-client/` – browser activation (`client.js`, `page-context.js`).
   - `jsgui3-server/` – server bootstrap (`server.js`, `controls/Active_HTML_Document`, `serve-factory.js`).
   - `lang-tools/` – `Data_Object`, `Evented_Class`, transform helpers.
   - `jsgui3-gfx-core/` – vector primitives (used by SVG controls).

3. **Document the Evidence**
   - Collect file paths, code snippets, and behaviours demonstrating the problem.
   - Record version numbers from each package’s `package.json`.

---

## 2. Reproduction Protocol

Use these techniques to reproduce issues reliably:

- **Control-level issues**: Create or adapt a minimal control (in application code) exercising the suspected behaviour. For example, instantiate a `Data_Model_View_Model_Control` and attach bindings mirroring the failing path.
- **Binding issues**: Run sample scripts such as `node node_modules/jsgui3-html/examples/binding_simple_counter.js` or write a custom script that uses `ModelBinder` directly.
- **Templating issues**: Use `parse_mount` inside a temporary script to parse the problematic markup. Log the generated controls to verify registration or binding metadata.
- **Server/client issues**: Run `node server.js` (from the project root) to trigger bundling and activation. Capture stack traces or runtime errors.
- **Mixins or vector issues**: Instantiate the control while logging DOM state and mixin hooks (e.g., `dragable.js` expects certain properties to exist).

Document exact commands, expected vs actual behaviour, and any stack traces or errors.

---

## 3. Gap Report Template

When a gap or defect is confirmed, create or update a report (Markdown) describing the findings. Recommended structure:

```markdown
# [Short Title: e.g., "Missing ControlRegistry alias support"]

## Summary
- Observed behaviour
- Expected behaviour
- Impacted use cases

## Reproduction Steps
1. Command or script used
2. Inputs / control definitions
3. Actual output / errors

## Analysis
- Suspected modules (e.g., `node_modules/jsgui3-html/html-core/parse-mount.js`)
- Key code excerpts (link to line numbers if possible)
- Related documentation references (e.g., `node_modules/jsgui3-html/DATA_BINDING.md` section)

## Recommended Fix
- Describe the upstream change needed
- Identify which package (`jsgui3-html`, `jsgui3-server`, etc.) should be updated
- Outline code-level adjustments (functions, classes, modules)

## Testing Plan
- Unit tests to add or adjust (refer to `node_modules/jsgui3-html/test/...` or create new ones upstream)
- Example scripts to run (e.g., `binding_user_form.js`)
- Manual verification steps (browser test, CLI script)

## Workarounds / Next Steps
- Temporary application-level workaround (if any)
- Links to related issues or documentation
- Suggested escalation path (e.g., upstream PR, issue submission)
```

Store reports in the application repository under `docs/` (for example, `docs/jsgui3-gap-<topic>.md`). Update existing reports instead of duplicating similar findings.

---

## 4. Mapping Common Problems to Modules

| Gap Category | Likely Modules | Notes |
|--------------|----------------|-------|
| Custom control tags not recognized | `jsgui3-html/html-core/parse-mount.js`, `html-core/html-core.js` | Ensure control registration, aliasing, and binding attributes are handled |
| Data bindings not updating | `html-core/ModelBinder.js`, `Transformations.js`, `Data_Model_View_Model_Control.js` | Inspect binding modes, watchers, and computed properties |
| Server-rendered HTML mismatches | `controls/organised/...`, `Control_Core`, `Control_View`, `Active_HTML_Document` | Check `all_html_render` vs `compose` vs `activate` |
| Mixins malfunction | `control_mixins/*.js` | Verify required control properties and event wiring |
| SVG/vector glitches | `controls/organised/0-core/1-advanced/vector/*`, `jsgui3-gfx-core` | Confirm coordinate calculations, transforms, event targets |
| Client activation errors | `jsgui3-client/client.js`, `page-context.js` | Validate `Page_Context`, `pre_activate`, `activate` flows |
| Server bundling failures | `jsgui3-server/server.js`, `serve-factory.js`, CLI scripts | Inspect module resolution, bundling pipelines |
| Utility shortcomings | `lang-tools` modules | Additions likely needed in upstream `lang-tools`; note function path |

---

## 5. Testing & Diagnostics Checklist

- `node --check <file>` for any application-level test harnesses you build.
- Example scripts under `node_modules/jsgui3-html/examples/` to confirm baseline behaviour.
- Integration tests under `node_modules/jsgui3-html/test/` (if available for the affected area).
- Custom reproduction scripts (store them outside `node_modules/`, e.g., under `controls/` or `scripts/`).
- Log comparison between server and client states (HTML snapshot vs runtime DOM).

Record which checks you executed and highlight any that could not be run (with reasons).

---

## 6. Escalation & Communication

1. Create or update a report in `docs/` summarising the issue.
2. Mention the report in ongoing work summaries (e.g., `Refer to docs/jsgui3-gap-controlregistry.md for pending upstream fix`).
3. If direct maintainer contact is needed, include version numbers, reproduction steps, and recommended changes.
4. Avoid shipping workarounds without documenting upstream requirements and risks.

---

## 7. Checklist for Each Gap

- [ ] Reproduced the problem and saved logs/outputs
- [ ] Identified affected modules/files with verified paths
- [ ] Drafted a Markdown report under `docs/`
- [ ] Proposed upstream changes (functions/classes/modules)
- [ ] Suggested tests covering the fix
- [ ] Noted any temporary workaround
- [ ] Shared the report reference in relevant summaries or comments

By following this guide, agents can keep the codebase clean while signaling improvements needed in the upstream jsgui3 packages.

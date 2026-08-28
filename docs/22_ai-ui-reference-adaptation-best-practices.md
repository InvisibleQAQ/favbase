# AI UI Reference Adaptation Best Practices

## 1. Purpose

This guide defines a controlled workflow for using an AI coding agent to study
the UI of a reference project and adapt its design language to a different,
existing product.

The reference project is evidence. The target product is authoritative.
Visual similarity is never allowed to override the target product's users,
tasks, domain language, data semantics, behavior, accessibility, brand, or
technical constraints.

This is not a one-pass cloning workflow. It separates discovery, design-system
extraction, product mapping, approval, implementation, and verification so that
an agent cannot silently convert visual resemblance into product regressions.

## 2. Core Decision

Use this model:

```text
Reference project: source + rendered UI + behavior evidence ----+
                                                              |
Target product: users + tasks + data + existing contracts -----+--> adaptation matrix
                                                                     |
                                                                     v
                                                          target design specification
                                                                     |
                                                                     v
                                                          one vertical slice
                                                                     |
                                                                     v
                                                   staged migration and verification
```

The desired output is a target-native interface that borrows proven design
intent. It is not a target-shaped copy of the reference project.

## 3. Evidence Discipline

Every research and planning claim must use one of these labels:

| Label | Meaning |
| --- | --- |
| `[REFERENCE_FACT]` | Directly observed in reference source or rendered behavior |
| `[TARGET_FACT]` | Directly observed in target source, tests, docs, or runtime |
| `[INFERENCE]` | A proposed explanation of why an observed pattern exists |
| `[DECISION]` | A choice approved for the target product |
| `[UNKNOWN]` | Missing information that could change the decision |

Do not present an inference as a reference fact. Do not present a visual
observation as a target decision. When source and runtime disagree, record both
and treat the rendered behavior as the visual fact until the discrepancy is
explained.

## 4. Required Artifacts

Complex adaptations should produce these artifacts before broad implementation:

1. `reference-ui-audit.md`
   - Reference screen and route inventory.
   - Rendered screenshots at representative states and viewports.
   - Token, component, layout, state, motion, and asset observations.
   - Exact evidence paths or runtime locations for every important claim.
2. `target-product-contract.md`
   - Users, primary tasks, information architecture, routes, and terminology.
   - Data relationships and behavior that the redesign must preserve.
   - Existing design-system owners, reusable components, and technical limits.
   - Accessibility, theme, locale, performance, and browser requirements.
3. `ui-adaptation-matrix.md`
   - Explicit mapping from reference intent to target need.
   - `keep`, `adapt`, `reject`, or `reimplement` decision for every pattern.
4. `target-design-spec.md`
   - Approved target-native tokens, component rules, layouts, and states.
   - Rules that are executable and testable rather than aesthetic adjectives.
5. `migration-plan.md`
   - Ordered vertical slices, owners, dependencies, rollback points, and checks.
6. `verification-report.md`
   - Functional, visual, accessibility, responsive, locale, and performance
     results for each completed slice.

File names may follow local project conventions. The separation of concerns is
the requirement.

## 5. Phase 1: Freeze the Target Product Contract

Inspect the target product before studying the reference in depth. Otherwise
the reference becomes the agent's default model of the product.

Record:

- Primary users and the tasks they actually complete.
- Route tree, navigation labels, page ownership, and URL behavior.
- Domain glossary and terms that must not be replaced by template language.
- Core workflows, including failure, cancellation, recovery, and empty states.
- Data semantics, especially counts, statuses, ownership, and relationships.
- Existing analytics identifiers, form names, deep links, and keyboard behavior.
- Existing reusable primitives, components, tokens, and styling mechanisms.
- Brand assets and commitments that must remain recognizable.
- Supported viewports, themes, locales, writing directions, and zoom levels.
- Accessibility and performance requirements.
- Files, APIs, behavior, and dependencies that are outside the redesign scope.

The target contract is the compatibility boundary. Any later proposal that
violates it must be rejected or explicitly approved as a separate product
change.

## 6. Phase 2: Capture Reference Evidence

Inspect both source and rendered behavior. Neither is sufficient alone.

### 6.1 Runtime inventory

Capture representative reference screens for:

- Desktop, narrow laptop, and mobile layouts.
- Light and dark themes when supported.
- Default, hover, focus-visible, active, disabled, and selected states.
- Loading, skeleton, empty, partial-data, error, and recovery states.
- Open menus, drawers, dialogs, popovers, tooltips, and validation messages.
- Long titles, long lists, missing media, overflow, and dense data.
- Motion start, transition, settled state, and reduced-motion behavior.

Record viewport, browser, theme, locale, route, state setup, and data fixture for
every screenshot. A screenshot without reproduction metadata is weak evidence.

### 6.2 Source inventory

Trace the owners of:

- Theme and token definitions.
- Application shell and responsive layout.
- Navigation configuration.
- Shared primitives and composite components.
- Page composition and route loading.
- State, data fixtures, and error boundaries.
- Fonts, icons, images, and motion utilities.
- Accessibility helpers and test infrastructure.

Search for repeated implementations before declaring a pattern canonical. A
single component may be an exception, demo, or obsolete experiment.

## 7. Phase 3: Extract the Reference Design Language

Extract decisions, not files.

### 7.1 Three-tier token model

Use three layers:

1. Primitive tokens
   - Raw scales such as colors, dimensions, font families, font weights,
     radii, shadows, opacity, durations, and easing values.
2. Semantic tokens
   - Purpose-based roles such as `text.primary`, `surface.default`,
     `action.selected`, `border.subtle`, and `status.error`.
3. Component tokens
   - Component-specific roles used only when semantic tokens are insufficient,
     such as `button.primary.background.hover`.

Components should consume semantic or component tokens, not arbitrary primitive
values. Preserve aliases and theme relationships so light, dark, contrast, or
brand variants do not duplicate whole token sets.

The Design Tokens Community Group 2025.10 format is a suitable neutral exchange
format when cross-tool portability is useful. A project-native theme object or
CSS-variable system remains valid when it is already the established owner.

### 7.2 Component contract

For every reference component worth considering, record:

- User intent and appropriate use cases.
- Anatomy and semantic HTML role.
- Required and optional content.
- Variants and size rules.
- State matrix.
- Keyboard and focus behavior.
- Responsive transformations.
- Theme behavior.
- Motion purpose and reduced-motion fallback.
- Edge cases and forbidden uses.

Do not infer component equivalence from names. A `medium` button in two systems
can differ in height, prominence, density, and purpose.

### 7.3 Layout and composition rules

Record:

- Shell dimensions and ownership.
- Container widths and content gutters.
- Grid columns, gaps, and collapse rules.
- Page hierarchy and first-viewport priorities.
- Density, alignment, and content-length assumptions.
- Sticky, fixed, scrolling, and overlay behavior.
- Stable dimensions for controls, media, tables, and repeated items.

Avoid converting every observed pixel into a token. Extract values only when
they form a repeated scale or represent a meaningful decision.

## 8. Phase 4: Build the Adaptation Matrix

The adaptation matrix is the central planning structure:

| Reference fact | Design intent | Target fact or need | Decision | Target implementation | Risk | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| Fixed navigation rail | Keep frequent destinations visible | Target has five stable primary routes | Adapt | Use target route registry and current responsive drawer | Narrow viewport overflow | Every route remains reachable at all supported widths |
| Account switcher | Change organization context | Target has no account or workspace concept | Reject | None | Fabricated product model | No account or workspace UI is introduced |
| Dense data table | Compare many homogeneous records | Target items require image-led recognition | Reimplement | Use target item component with stable media and metadata slots | Lost scan efficiency | Representative task test meets agreed completion target |

Allowed decisions:

- `keep`: the target already has the correct pattern and should retain it.
- `adapt`: the reference intent is useful but must use target semantics and
  existing owners.
- `reject`: the pattern conflicts with target users, data, behavior, or brand.
- `reimplement`: the intent is useful but the reference structure is the wrong
  abstraction for the target.

Every accepted row needs evidence, an owner, a risk, and a binary acceptance
criterion. Rows without those fields are unresolved proposals.

## 9. Phase 5: Approve the Target Design Specification

Convert approved matrix rows into a target-native specification. It must define:

- Target tokens and their semantic purpose.
- Typography hierarchy and content-length bounds.
- Shape, elevation, divider, and surface rules.
- Shell, grid, container, and responsive geometry.
- Shared component anatomy, variants, and states.
- Navigation, focus, keyboard, and overlay behavior.
- Loading, empty, error, offline, partial, and recovery patterns.
- Theme, locale, long-text, missing-media, and reduced-motion behavior.
- Explicit forbidden patterns and non-goals.
- Verification routes, fixtures, viewports, and expected results.

Avoid vague instructions such as "make it modern" or "match the reference."
Replace them with observable rules and pass/fail checks.

No broad implementation begins until a human reviews this specification and the
adaptation matrix.

## 10. Phase 6: Implement One Vertical Slice

Choose one representative slice that exercises the complete design path:

- Shared tokens.
- Application shell or page scaffold.
- At least one shared component.
- Real target data and terminology.
- Interactive and asynchronous states.
- Desktop and mobile behavior.
- Light and dark themes when supported.
- Automated and manual verification.

Prefer an important but reversible workflow. Do not begin with the largest,
most exceptional, or most safety-critical screen.

After the slice:

1. Compare the result with the target specification, not reference pixels.
2. Record mapping mistakes and missing target rules.
3. Fix the specification before expanding the implementation.
4. Ask for approval to continue to the next slice.

## 11. Phase 7: Migrate in Layers

Apply changes from broad owners to narrow consumers:

1. Semantic token definitions.
2. Global component defaults and variants.
3. Shared shell and layout primitives.
4. Shared domain components.
5. Page compositions.
6. Documented local exceptions.

Do not spread local style overrides across pages to simulate a coherent system.
If the same intent appears three or more times, find or define one shared owner.
Do not create a new abstraction merely because two elements look similar; they
must also share intent and behavior.

Each slice should be reviewable and reversible. Keep behavior changes separate
from visual migration unless the behavior change is explicitly approved.

## 12. Verification Matrix

### 12.1 Component states

Represent each meaningful state as an isolated story, fixture, or deterministic
test case:

- Default, hover, focus-visible, active, selected, and disabled.
- Loading, empty, partial, error, success, and retry.
- Long text, large numbers, missing images, and no optional metadata.
- Light, dark, contrast, and reduced-motion variants when supported.

Storybook stories can act as executable component test cases. Interaction
`play` functions should simulate user actions and assert outcomes for stateful
components.

### 12.2 Functional behavior

Verify:

- Existing routes and deep links.
- Navigation and browser history.
- Links, form submission, validation, and recovery.
- Keyboard order, shortcuts, focus restoration, and escape behavior.
- Data loading, pagination, filtering, sorting, and mutations.
- Existing event identifiers and public component contracts.

Visual success never compensates for broken behavior.

### 12.3 Accessibility

Use WCAG 2.2 as the baseline where applicable. Check:

- Semantic regions, headings, labels, names, descriptions, and live regions.
- Full keyboard operation and visible, unobscured focus.
- Text, control, focus-indicator, and non-text contrast.
- Reflow, zoom, target size, and target spacing.
- Dialog focus trapping and restoration.
- Screen-reader announcements for loading, errors, and state changes.
- Reduced-motion behavior.

Automated checks are necessary but insufficient. Manually test the primary path
with keyboard and a representative screen reader.

### 12.4 Responsive and locale coverage

Test at minimum:

- Wide desktop.
- Target reference desktop or laptop size.
- Narrow desktop or tablet width.
- Supported mobile width.
- Browser zoom and enlarged text.
- Long English strings and representative CJK strings when supported.
- Right-to-left layout when supported.

Check overflow, overlap, clipping, wrapping, control stability, sticky regions,
and touch target spacing. A desktop screenshot scaled down is not a responsive
specification.

### 12.5 Visual regression

Create baselines for the approved target design, not for pixel parity with the
reference project.

For stable screenshot comparisons:

- Use the same operating system, browser version, viewport, fonts, settings,
  headless mode, and device scale as the baseline environment.
- Use deterministic data and network responses.
- Wait for fonts, images, loading, layout, and asynchronous state to settle.
- Disable or deterministically settle animations and caret blinking.
- Mask only genuinely volatile content. Do not mask real defects.
- Keep thresholds narrow and justified.
- Require human review before updating accepted baselines.

Playwright `toHaveScreenshot()` waits for two consecutive matching screenshots,
but environment consistency and baseline review are still required.

### 12.6 Performance and stability

Check:

- Layout shift and reserved media dimensions.
- Main-thread work and interaction responsiveness.
- Bundle changes and newly introduced dependencies.
- Image and font loading behavior.
- Repeated renders, observers, timers, and animation cleanup.
- Console errors, hydration issues, and runtime warnings.

## 13. AI Agent Execution Contract

Do not ask an agent to inspect, decide, implement, and verify the whole redesign
in one prompt. Split the work into explicit stages.

### Stage A: read-only discovery

Agent permissions:

- Read source, docs, tests, and runtime output.
- Search both projects and trace ownership.
- Capture evidence and unresolved questions.
- Do not edit files, add dependencies, or invent product facts.

Required output:

- Reference audit.
- Target product contract.
- Evidence-tagged unknowns and contradictions.

### Stage B: mapping and design specification

Agent permissions:

- Propose tokens, mappings, target rules, risks, and acceptance criteria.
- Reuse target owners before proposing new abstractions.
- Do not implement.

Required output:

- Adaptation matrix.
- Target design specification.
- Vertical-slice recommendation.
- Explicit rejection list.

Stop for human approval.

### Stage C: vertical-slice implementation

Agent permissions:

- Modify only approved files and owners.
- Preserve routes, behavior, data contracts, terminology, and test coverage.
- Stop before adding dependencies, changing public contracts, or expanding
  scope.

Required output:

- One implemented slice.
- Focused tests and verification evidence.
- Deviations from the approved design specification.

Stop for review before broader migration.

### Stage D: staged rollout

Agent permissions:

- Apply only approved mappings in ordered slices.
- Run focused checks after each slice and full checks at defined milestones.
- Keep changes small enough to review and roll back.

Required output:

- Slice-by-slice changes.
- Updated verification report.
- Remaining risks and rejected work.

## 14. Failure Patterns

Reject these approaches:

- Giving the agent both repositories and asking it to "make B look like A."
- Treating one screenshot as a complete design system.
- Copying component names or props without verifying semantic equivalence.
- Replacing target terminology with demo or template language.
- Inventing accounts, metrics, charts, avatars, or workflows absent from B.
- Building a second component library beside an existing owner.
- Hard-coding reference values throughout target pages.
- Migrating every page before validating one representative slice.
- Using reference screenshots as target pixel-golden files.
- Approving output because it compiles or looks plausible.
- Updating visual baselines without inspecting the diff.
- Testing only the default successful desktop state.
- Combining unrelated behavior changes with the visual migration.

## 15. Definition of Done

The adaptation is complete only when:

- Every implemented reference pattern has an approved adaptation-matrix row.
- Target routes, terminology, data semantics, and behavior remain correct.
- Shared intents have one documented owner.
- No unsupported reference feature or demo content appears in the target.
- Component state and interaction checks pass.
- Accessibility checks and manual keyboard review pass.
- Responsive, theme, locale, empty, error, and missing-media checks pass.
- Visual diffs are reviewed against target-owned baselines.
- Performance and console checks pass.
- Documentation matches the implemented system.
- Remaining exceptions and follow-up slices are explicit.

## 16. Research Basis

- Design Tokens Community Group, Design Tokens Specification 2025.10:
  <https://www.designtokens.org/tr/2025.10/>
- Zalando Engineering, "LLM powered migration of UI component libraries":
  <https://engineering.zalando.com/posts/2025/02/llm-migration-ui-component-libraries.html>
- 1Password, "From Jira to PR: How we built agent-driven pipelines for design
  system changes":
  <https://1password.com/blog/agent-driven-design-system>
- Storybook, "How to test UIs with Storybook":
  <https://storybook.js.org/docs/writing-tests/>
- Playwright, "Visual comparisons":
  <https://playwright.dev/docs/test-snapshots>
- W3C, Web Content Accessibility Guidelines 2.2:
  <https://www.w3.org/TR/WCAG22/>
- Smashing Magazine, "Copying Designs Doesn't Work, And Here's Why":
  <https://www.smashingmagazine.com/2023/01/copying-designs-doesnt-work/>

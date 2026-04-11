# CRM Design System — Principles

> *"Design is not just what it looks like and feels like. Design is how it works."*
> This design system exists to make every interaction with our CRM feel inevitable — as though no other design could have been the right one.

---

## Vision

Build the most intuitive, efficient, and delightful enterprise CRM interface on the market. Every pixel serves a purpose. Every interaction respects the user's time. Every screen earns its place.

---

## Core Principles

### 1. Clarity Over Cleverness

The interface should be immediately understandable. Users should never wonder "what does this do?" A clear design that works on first contact beats a clever one that requires learning.

**In practice:**
- Labels over icons when meaning is ambiguous
- Explicit state changes over subtle animations
- Progressive disclosure over front-loaded complexity
- One primary action per context — never make users choose between equals

**Do:**
- Use plain language: "Delete contact" not "Remove entity"
- Show the outcome before confirming destructive actions
- Make the current state visible at all times

**Don't:**
- Hide critical actions in overflow menus
- Use jargon or internal terminology in the UI
- Rely solely on color to communicate meaning

---

### 2. Density With Breathing Room

Enterprise users process hundreds of records daily. The interface must maximize information density without feeling cramped. The 8px grid and deliberate whitespace create rhythm and hierarchy.

**In practice:**
- Data tables show 25+ rows without scrolling on standard displays
- Cards use compact spacing but maintain clear visual separation
- Sidebars collapse to icon-only mode for maximum workspace
- Typography scale creates clear hierarchy without excessive size jumps

**Do:**
- Use the compact variant for data-heavy views
- Group related information with subtle borders or background shifts
- Let content breathe — 16px minimum padding on content containers

**Don't:**
- Cram controls into every available pixel
- Use large hero sections in workflow screens
- Add decorative elements that consume productive space

---

### 3. Speed as a Feature

Perceived performance is UX. Every interaction should feel instant. The system is designed to minimize cognitive load and maximize throughput for power users.

**In practice:**
- Keyboard shortcuts for every primary action
- Optimistic UI updates — don't wait for the server
- Skeleton screens that match final layout exactly
- Inline editing eliminates modal overhead
- Command palette (Cmd+K) for instant navigation

**Do:**
- Show loading states within 100ms of user action
- Pre-fetch data for likely next screens
- Support bulk actions on data tables
- Animate at 60fps or don't animate at all

**Don't:**
- Block the UI during background operations
- Use full-page loaders for partial data refreshes
- Add unnecessary confirmation dialogs for reversible actions
- Use transitions longer than 300ms for functional elements

---

### 4. Consistent, Not Uniform

Every component follows the same foundational rules — spacing, color, typography, interaction patterns — but adapts to context. A button in a dialog behaves like a button in a toolbar, but may differ in size or emphasis.

**In practice:**
- All interactive elements use the same focus ring style
- Spacing follows the 8px grid universally
- Color tokens, not raw values, define every surface and text color
- Component APIs share common prop patterns (size, variant, disabled)

**Do:**
- Use design tokens for all visual properties
- Follow established patterns before inventing new ones
- Reuse existing components with variant props

**Don't:**
- Create one-off components for edge cases
- Override token values with hardcoded colors
- Mix interaction patterns (e.g., some selects open on click, others on hover)

---

### 5. Accessible by Default

Accessibility is not a feature — it's a constraint that makes the product better for everyone. Every component meets WCAG 2.2 AA as a baseline. The system is designed so that building accessibly is the path of least resistance.

**In practice:**
- All color combinations meet 4.5:1 contrast ratio minimum
- Every interactive element is keyboard navigable
- Screen reader announcements are built into component APIs
- Focus management is handled by the component library
- Motion respects `prefers-reduced-motion`

**Do:**
- Test with keyboard-only navigation
- Include `aria-label` when visual labels are absent
- Use semantic HTML elements (button, nav, main, etc.)
- Provide text alternatives for all non-text content

**Don't:**
- Use color as the sole indicator of state
- Remove focus indicators for aesthetic reasons
- Use `div` with `onClick` instead of `button`
- Auto-play animations without user control

---

### 6. Trust Through Transparency

Users manage critical business data. The interface must always communicate what's happening, what happened, and what will happen next. No silent failures. No ambiguous states.

**In practice:**
- Every destructive action has a clear confirmation with consequences stated
- Save states are always visible (saved, saving, unsaved changes)
- Error messages explain what went wrong AND how to fix it
- Undo is available for all non-destructive bulk operations
- Audit trails are surfaceable in-context

**Do:**
- Show timestamp of last sync/save
- Provide inline validation with actionable guidance
- Use toast notifications for background operation completion
- Make "undo" the primary action after bulk operations

**Don't:**
- Silently discard user input
- Show generic error messages ("Something went wrong")
- Hide system status behind extra clicks
- Auto-dismiss critical error notifications

---

## Design Decision Framework

When making design decisions, evaluate against this priority stack:

```
1. Accessibility     — Can everyone use it?
2. Clarity           — Is it immediately understandable?
3. Efficiency        — Does it respect the user's time?
4. Consistency       — Does it follow established patterns?
5. Aesthetics        — Does it feel considered and refined?
```

If two principles conflict, the higher-priority principle wins. A beautiful design that isn't accessible ships broken. A consistent design that isn't clear ships confusing.

---

## Naming Conventions

| Layer          | Convention           | Example                          |
|----------------|----------------------|----------------------------------|
| Design tokens  | `category.property.variant.state` | `color.bg.surface.hover`  |
| Components     | PascalCase           | `DataTable`, `SearchField`       |
| Props          | camelCase            | `isDisabled`, `colorScheme`      |
| CSS classes    | BEM-like with prefix | `crm-button--primary-lg`         |
| Icons          | kebab-case           | `arrow-right`, `user-plus`       |
| Spacing tokens | t-shirt sizes + scale | `space.xs` (4px), `space.md` (16px) |

---

## Contribution Model

### Proposing a New Component

1. **Check existing components** — Can an existing component be extended with a variant?
2. **Document the need** — Where will this be used? By how many features? How often?
3. **Submit a design spec** — Anatomy, states, accessibility requirements, token usage
4. **Build and review** — Implementation must pass accessibility audit and visual regression tests
5. **Document and publish** — Add to design system with usage guidelines

### Modifying an Existing Component

1. **File an RFC** — Describe what changes and why
2. **Audit usage** — Identify all current consumers
3. **Implement behind feature flag** — Gradual rollout
4. **Migrate consumers** — Update all usage before removing old API
5. **Update documentation** — Tokens, guidelines, code examples

---

## Version History

| Version | Date       | Summary                                     |
|---------|------------|---------------------------------------------|
| 1.0.0   | 2026-04-11 | Initial design system release               |

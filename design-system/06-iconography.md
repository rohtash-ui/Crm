# CRM Design System — Iconography

---

## Philosophy

Icons are a visual shorthand. In a data-dense CRM, they reduce cognitive load by replacing or reinforcing text labels. Every icon in this system earns its place by being immediately recognizable, consistently styled, and accessible.

Our icon system follows three rules:

1. **Meaning before decoration** — An icon must communicate faster than the text it replaces. If it can't, use text.
2. **One style, everywhere** — All icons use the same stroke weight, corner radius, and optical grid.
3. **Always paired** — Icons always have a text label or `aria-label`. No icon exists without an accessible name.

---

## Icon Grid & Sizing

All icons are designed on a **24x24px optical grid** with a **2px stroke weight** and **2px padding** (20x20 live area).

| Token           | Size   | Stroke | Usage                                       |
|-----------------|--------|--------|---------------------------------------------|
| `size.icon.xs`  | 12px   | 1.5px  | Inline indicators (sort arrows, status dots)|
| `size.icon.sm`  | 16px   | 1.5px  | Compact UI (table actions, breadcrumb separators) |
| `size.icon.md`  | 20px   | 2px    | Default — buttons, inputs, navigation items |
| `size.icon.lg`  | 24px   | 2px    | Section headers, card titles, standalone icons |
| `size.icon.xl`  | 32px   | 2px    | Empty states, feature highlights, onboarding |

### Optical Sizing

Icons scale proportionally. At `xs` and `sm` sizes, stroke weight reduces to 1.5px to maintain visual balance. Below 12px, icons should not be used — replace with text or dots.

---

## Style Specifications

| Property          | Value                          |
|-------------------|--------------------------------|
| Style             | Outlined (not filled)          |
| Stroke weight     | 2px (default), 1.5px (sm/xs)  |
| Stroke cap        | Round                          |
| Stroke join       | Round                          |
| Corner radius     | 2px on squared elements        |
| Fill              | None (stroke only)             |
| Color             | Inherits from parent `color`   |

### Why Outlined

Outlined icons provide:
- Better readability at small sizes in data-dense layouts
- Lighter visual weight that doesn't compete with text
- Clear distinction between active (filled) and inactive (outlined) states in navigation

### Filled Variant

A filled variant exists only for **active/selected states** in navigation:
- Active sidebar item → filled icon
- Active tab → filled icon
- Selected bottom nav → filled icon

All other contexts use the outlined variant exclusively.

---

## Color Usage

Icons inherit text color from their parent element. Do not assign icon-specific colors except for semantic status indicators.

| Context                  | Color Token                      | Example              |
|--------------------------|----------------------------------|----------------------|
| Default (in text)        | `color.fg.default`               | Navigation items     |
| Muted/secondary          | `color.fg.muted`                 | Helper icons         |
| Disabled                 | `color.fg.subtle`                | Disabled button icon |
| Brand/interactive        | `color.fg.brand`                 | Link icons           |
| On brand surface         | `color.fg.onBrand`               | Icon in primary button |
| Success status           | `color.fg.success`               | Checkmark in alert   |
| Warning status           | `color.fg.warning`               | Warning triangle     |
| Danger/error             | `color.fg.danger`                | Error X icon         |

---

## Icon-to-Text Spacing

When icons appear alongside text, use the `inline` spacing tokens:

| Layout                   | Gap Token          | Value | Example                    |
|--------------------------|--------------------|-------|----------------------------|
| Icon + label (button)    | `spacing.alias.inlineXs` | 4px   | `[icon] Save`         |
| Icon + label (nav item)  | `spacing.alias.inlineSm` | 8px   | `[icon]  Contacts`    |
| Icon + body text         | `spacing.alias.inlineSm` | 8px   | `[icon]  12 records`  |
| Standalone icon button   | N/A — no text gap  | —     | `[icon]`               |

Icons vertically align to the **center of the first line of text** they accompany.

---

## Core Icon Set

### Navigation & Wayfinding

| Icon Name          | Usage                              |
|--------------------|------------------------------------|
| `home`             | Dashboard / home navigation        |
| `arrow-left`       | Back navigation                    |
| `arrow-right`      | Forward, next, breadcrumb separator|
| `chevron-down`     | Dropdown trigger, expand           |
| `chevron-right`    | Drill-in, sub-navigation           |
| `chevron-up`       | Collapse                           |
| `menu`             | Mobile hamburger, sidebar toggle   |
| `x`                | Close dialog, dismiss              |
| `search`           | Search field, command palette      |
| `external-link`    | Opens in new window                |

### CRM Domain

| Icon Name          | Usage                              |
|--------------------|------------------------------------|
| `users`            | Contacts list                      |
| `building`         | Accounts / companies               |
| `target`           | Leads                              |
| `dollar-sign`      | Deals / revenue                    |
| `bar-chart`        | Reports / analytics                |
| `mail`             | Email activities                   |
| `phone`            | Call activities                    |
| `calendar`         | Meetings, date picker              |
| `check-square`     | Tasks                              |
| `zap`              | Automations / workflows            |
| `megaphone`        | Campaigns                          |
| `sliders`          | Settings / configuration           |
| `shield`           | Security / permissions             |
| `bell`             | Notifications                      |
| `clock`            | Activity timeline, recent items    |

### Actions

| Icon Name          | Usage                              |
|--------------------|------------------------------------|
| `plus`             | Create / add new                   |
| `edit`             | Edit record                        |
| `trash`            | Delete (always with confirmation)  |
| `copy`             | Duplicate / copy to clipboard      |
| `download`         | Export / download                  |
| `upload`           | Import / upload                    |
| `filter`           | Filter controls                    |
| `sort-asc`         | Sort ascending                     |
| `sort-desc`        | Sort descending                    |
| `more-horizontal`  | Overflow menu (three dots)         |
| `more-vertical`    | Overflow menu (vertical dots)      |
| `refresh`          | Refresh / sync                     |
| `link`             | Attach / connect                   |
| `eye`              | View / preview                     |
| `eye-off`          | Hide / toggle visibility           |
| `lock`             | Locked / read-only                 |
| `unlock`           | Unlocked / editable                |

### Status & Feedback

| Icon Name          | Usage                              |
|--------------------|------------------------------------|
| `check`            | Success, completed                 |
| `check-circle`     | Success alert                      |
| `alert-triangle`   | Warning alert                      |
| `alert-circle`     | Error / danger alert               |
| `info`             | Informational alert, tooltip trigger |
| `loader`           | Loading spinner (animated)         |
| `circle`           | Status dot (filled, colored)       |

---

## Accessibility

### Requirements

1. **Every icon must have an accessible name.** Use one of:
   - Visible text label adjacent to the icon
   - `aria-label` on the icon button
   - `aria-hidden="true"` if the icon is purely decorative and text is present

2. **Minimum touch target: 44x44px** for interactive icons on touch devices, regardless of icon size.

3. **Minimum click target: 24x24px** for desktop, with at least 8px spacing between adjacent targets.

4. **Never use color alone** to convey meaning. Pair colored status icons with labels or shapes.

### Implementation Pattern

```jsx
{/* Decorative icon with visible label */}
<Button>
  <Icon name="plus" aria-hidden="true" />
  <span>Add Contact</span>
</Button>

{/* Icon-only button — aria-label required */}
<IconButton aria-label="Delete contact">
  <Icon name="trash" />
</IconButton>

{/* Status icon — conveys meaning, needs label */}
<span role="img" aria-label="Error">
  <Icon name="alert-circle" color="danger" />
</span>
<span>Email is required</span>
```

---

## Icon as Component API

```tsx
interface IconProps {
  /** Icon name from the icon set */
  name: string;
  /** Size variant */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';    // default: 'md'
  /** Semantic color override */
  color?: 'default' | 'muted' | 'subtle' | 'brand' | 'success' | 'warning' | 'danger' | 'onBrand';
  /** Accessible label — required if no adjacent text */
  'aria-label'?: string;
  /** Set true when icon is decorative alongside visible text */
  'aria-hidden'?: boolean;
  /** Additional CSS class */
  className?: string;
}
```

---

## Do's and Don'ts

### Do

- Use icons from the approved set — consistency matters more than perfect metaphor
- Pair every icon with a text label in navigation
- Use the `md` (20px) size as your default
- Let icons inherit color from their text context
- Use filled variants only for active navigation states
- Test icon recognition with users for domain-specific icons

### Don't

- Create custom one-off icons without adding them to the system
- Use icons smaller than 12px
- Mix outlined and filled styles in the same context
- Use icons as the sole means of communicating critical information
- Apply rotation or flip transforms to change icon meaning
- Use emoji as icons

---

## Adding New Icons

1. **Check the existing set** — Can an existing icon work?
2. **Follow the grid** — Design on the 24x24 grid, 2px stroke, round caps/joins
3. **Test at all sizes** — Must be legible at 12px and balanced at 32px
4. **Name with kebab-case** — Descriptive, not metaphorical (`user-plus` not `add-friend`)
5. **Export as SVG** — Optimized, no embedded styles, `currentColor` for stroke
6. **Submit for review** — Include usage context and rationale

---

## File Format & Delivery

| Property          | Specification                     |
|-------------------|-----------------------------------|
| Format            | SVG (optimized via SVGO)          |
| Color             | `currentColor` — inherits CSS     |
| Viewbox           | `0 0 24 24`                       |
| Naming            | kebab-case: `arrow-right.svg`     |
| Delivery          | Sprite sheet + individual files   |
| React wrapper     | `<Icon name="..." />` component   |
| Tree-shaking      | Per-icon imports available         |

```svg
<!-- Example: check-circle.svg -->
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
     viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10"/>
  <path d="m9 12 2 2 4-4"/>
</svg>
```

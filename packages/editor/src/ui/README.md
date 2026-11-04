# Shared UI conventions

GridKit is a dense editing tool. Keep its existing type, color and spacing roles in
`../styles.css`; compose the primitives here before adding local variants.

- **Color:** burgundy identifies primary actions and selections; tinted surfaces
  separate the editing frame from content. Information and running states use blue,
  completed runs use green, mapping cautions use amber, and errors use red. Pair
  these roles with text or icons. Use `--color-focus` for focus and carets, and keep
  semantic UI colors separate from chart traces and user-defined data scales.

- **Frame:** `AppShell` owns the viewport, safe-area insets, header, Views navigation,
  main landmark and keyboard skip link. Pass `header` and `navigation` snippets for
  an open case; omit both for welcome. Header and bottom navigation size to content.
  Below 768px navigation moves to the bottom; short side rails scroll independently.
  On mobile the header and rail backgrounds reach the screen edges. The header
  owns the top inset, and both respect side insets. Rail controls sit at the bottom
  with only their normal 2px padding, without a reserved strip underneath. Keep
  rail focus outlines inside the buttons.
  Never give descendants another viewport height or make the document scroll.
- **Scrolling:** apply `c-scroll-region` to the content that should scroll. It
  supplies minimum sizes, scroll containment and a stable scrollbar gutter. Welcome,
  library lists and property sheets share this contract. Keep tables horizontally
  scrollable inside their own viewport; do not shrink columns to fit the shell.
- **Controls:** use `--control-height`, `--control-font-size`, `c-icon-btn`,
  `c-field`, `SearchField`, and the existing typography roles. Use `c-action` for
  full-width icon-and-label commands in Welcome, library rows, model choices, and
  menus; it owns alignment, spacing, control type, and nonshrinking icons. The global input
  policy gives narrow screens and any touch-capable device 44px controls and 16px
  input text. Do not add a separate `pointer: coarse` size override in each component.
  Use intrinsic height for text buttons so enlarged text can wrap.
  Native selects share theme colors for their options. Where `base-select` is
  supported, CSS also styles the picker, groups and checkmark; other browsers keep
  their native picker. Keep focus rings inset so scrolling containers cannot clip
  them, and use `--color-selection-border` for a selected control's real border.
- **Dock boundaries:** `ResizeHandle` is a focusable separator controlling the
  adjoining panel. Pointer capture keeps dragging reliable outside the boundary;
  arrows move 10px (Shift: 40px), Home/End reach bounds, Escape cancels a drag,
  and Enter or double-click restores the default. Keep the 44px grip target and
  use existing focus and surface tokens. The host owns size limits and remembers
  each edge in memory; resizing never writes preferences on every pointer event.
- **Results:** one header row starts with the content-sized quantity selector
  (capped at 18rem) and its units/current measurement mode. Stop, options and close
  stay accessible; routine completion status moves into options in narrow docks.
  `Popover` and `c-options` group native display radios, reference actions, plot
  commands, color controls, downloads and docking. Time/speed stay with playback
  below the plot. Close returns focus to the active view; a new run expands results.
- **Solver:** the third view in the rail owns simulation settings. Preferences and
  view toolbars do not repeat it. `SolverView` owns the case-scoped draft and actions;
  `SolverSettings` owns the existing form, validation and JSON import/export. Mount
  it on first use, retain it across navigation, and reset it when the case changes.
  Navigation focuses the heading. Apply commits a valid draft; Run applies and
  submits it. Contextual setup and quick simulation guard unapplied edits before
  replacement. The running study remains a snapshot. Integration fields use the
  shared property rows; raw JSON is optional and pending JSON blocks submission.
- **Tables:** keep the identity column visible during horizontal scrolling. Show
  Class only in a mixed-class table, and search counts inside the existing search
  field only while searching. Numeric display precision never changes exact cell
  values, sorting, properties, or export. Undo/Redo remain keyboard commands.
- **Dialogs:** use `Dialog` for focus containment, Escape, focus restoration,
  visual-viewport bounds (including the onscreen keyboard) and wrapping footer actions. Its body may scroll; headers and
  footer actions remain outside that scrolling region. Use `compact` for short tasks.
  Browsing dialogs should not autofocus search: let touch users see the list before
  choosing to bring up a keyboard. `Popover` focuses the selected choice, grid, or
  first available non-editing control after opening. Its container is the fallback.
  `Dialog` keeps native initial focus on its header controls. Return focus to the
  opener; `AppShell` focuses activated dialog/popover triggers before opening so
  Safari captures the same opener. Search results use the stable `SearchField` group.
  `SearchField.focus()` focuses that group without entering text. Clearing retains
  input focus only when already typing; Back and Reset return to a stable browsing
  target. Keep deliberate field focus for typing and validation errors. Button labels are nonselectable; fields and
  readable content retain normal text selection.
- **Case entry:** Library is the primary action; Open file is the secondary action
  and becomes primary when there is no library. Cases stay in memory until
  explicitly downloaded. There is no New case action or automatic session restore.
- **Library:** keep one folder/case list in its usual order. Shared favorites from
  the optional `library.json` replace the file glyph with a star and expose
  “Favorite” to assistive technology. Keep the dialog height stable across loading,
  search and navigation, bounded by `Dialog`'s visual viewport. `SearchField` stays
  above the scrolling list; browsing never focuses a typing field. Keep rows plain,
  without date/size strings or dot separators. Favorites load independently of the
  current folder; missing or invalid metadata never blocks browsing. Read case
  files only when opened.
- **Welcome and lists:** constrain width with `minmax(0, ...)` and `max-width: 100%`.
  Center scrollable content with auto margins, which yield to overflow, rather than
  unsafe grid centering. Keep row actions visible for touch and keyboard users.
- **Accessibility:** name icon buttons, use `aria-current` for active navigation,
  preserve a visible selected border in forced colors, and expose full names when
  visible text is truncated. Keep status announcements outside `aria-busy` regions.

Validate changes at 320px, phone landscape, tablet portrait/landscape and desktop;
include populated libraries, long names, touch input, keyboard focus, enlarged
text, dark theme and forced colors. Emulation does not replace physical-device QA.

Run the shell and library Safari-engine regressions after building with
`pnpm -F @gridkit/editor exec playwright test --project webkit`.

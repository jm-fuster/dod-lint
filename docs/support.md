# DoD Lint · Help and support

DoD Lint is a Figma plugin that checks a design system against a Definition of Done: auto layout, tokens, states, overlapping variants, touch targets, real content, component properties, slots, documentation, detached instances, broken references and text contrast. It lists each problem on the layer that has it and fixes the ones with a single right answer.

## Getting started

1. Open a Figma design file and run **Plugins → DoD Lint**.
2. Choose what to audit: **Selection**, **Page** or **File** (every page).
3. Click **Audit**. To choose which checks run, open **Settings** (the sliders icon): the rules are at the top. Settings are saved in the file, so everyone who opens it with DoD Lint audits with them; only the language is yours alone.
4. Click a finding to select that layer on the canvas.
5. **Fix all** on a check applies every safe fix of that check in one go, and the wrench button on a row, which names the variable it binds, fixes just that row. Each batch is a single undo step, and a notice at the bottom offers **Undo** for a few seconds. It removes the whole batch as long as nothing else has changed in the file since. While DoD Lint has the focus, Figma doesn't receive its shortcuts, so DoD Lint handles Ctrl+Z (Cmd+Z on Mac) itself: it does what the notice offers, or else passes the undo on to Figma. To redo, click the canvas and press Ctrl+Shift+Z (Cmd+Shift+Z on Mac).
6. **Report** gives you the audit in Markdown, to copy or download.

## The checks

| Check | What it flags |
|---|---|
| Auto layout at every level | Frames and groups with two or more children and no auto layout. Top-level artboards, icons and vector art are skipped. |
| Padding, gap and radius use tokens | Values typed by hand, and values off your spacing and radius scale. A radius that already makes a pill is bound to the scale’s largest step, so it stays a pill at any size. If no spacing (or radius) variables are in use at all, a note says how many values were typed by hand instead of flagging every layer. |
| Text styles and resizing | Text without a text style or typography variables; fixed-size text boxes without truncation. |
| Colors use tokens | Solid fills and strokes with a literal color and no variable or style. The frame of a variant set, which no instance inherits, isn’t checked. |
| Semantic tokens, not primitives | Fills and strokes bound straight to a variable from a primitive collection. Palette swatches named after the primitive they show are skipped. |
| Complete states | Sets whose State axis is missing states, and interactive components without one. Buttons need Default, Hover, Pressed, Focus and Disabled; fields and selection controls, the same without Pressed. States are recognized in English, Spanish, French, German, Portuguese and Italian, with their synonyms (Enabled = Default, Active = Pressed). |
| Variants don’t overlap | Variants in a set that overlap on the canvas. If one covers half or more of another, they’re stacked and the one below goes unnoticed. |
| Minimum touch target | Interactive components whose shorter side is below the minimum: 24 px by default, the WCAG 2.2 AA one. With a higher minimum, small sizes (Size=sm, xs, compact…) only need 24 px. |
| Real content, not placeholders | Generic default text in components ("Text", "Label", "Button"…) and lorem ipsum anywhere. If it’s the default value of a text property, which each instance changes, it’s listed as info. |
| Exposed properties | Components with text but no text property, or a swappable icon with no instance swap or boolean. |
| Slots defined and respected | See [Slots](#slots). |
| Description and documentation | Components without a useful description and, if you turn it on in settings, without a documentation link. Icons don’t count. |
| No detached instances | Frames detached from their component, which no longer get its changes. The component is named if it’s local. If it was deleted, it’s listed as info: there’s nothing to relink. |
| Broken references | Variables, styles and main components that no longer resolve, and modes set on layers or pages for collections that no longer exist. On an instance of a component in the same file, only what it overrides: the rest is checked in the component. From a library or a deleted component, the whole instance is checked. |
| Text contrast | WCAG contrast against the effective background, in each text's own mode and, inside components, in every mode its colors depend on (light and dark, roles, brands). A mode set on a frame or the page is respected. |

## Slots

- Content placed in an instance's slots is audited like any other layer.
- A slot's default content is checked once, in its component, and not again in every instance.
- In components, DoD Lint flags:
  - slot properties with no layer;
  - slots without auto layout;
  - default content that breaks the slot's own limits;
  - "Only allow preferred instances" with an empty list;
  - slot properties without a description.
- In instances, it flags slots below their minimum (including a required slot left empty), above their maximum, or with content outside the preferred instances, using the limits Figma calculates.
- Fixes are never offered on a slot's default content inside an instance: in Figma, editing one layer of a slot overrides the whole slot, and it stops receiving changes from its component.

## Settings

- **Language:** Automatic (your system language), English or Español.
- **Primitive collections:** detected automatically (hidden from publishing, or named like primitives, and with no aliases) or picked by hand.
- **Thresholds:** minimum control size, required states for buttons and for fields, the names that identify an interactive control, minimum description length, whether to require a documentation link (off by default) and ignored layer prefixes (`_` and `.` by default).
- **Traversal:** include hidden layers, go inside instances, require auto layout on top-level frames, check spacing and radius only inside components, and snap to the nearest scale step when fixing (off by default, because it changes the measurement).
- **Spacing and radius only inside components** is for library files, where documentation, sketches and sample screens would bury the components' findings. It's off by default: in a product file, the screens are what you want to check. Another way to leave documentation out is to start its frames' names with an ignored prefix.

Everything except the language is saved in the file, so everyone who opens it with DoD Lint audits with the same settings.

## FAQ

**Does DoD Lint change my file?**
Only when you click Fix or ignore a finding. Audits only read. Saving settings writes the list of primitive collections into the file's plugin data, and ignoring a finding writes it there too.

**How long does an audit take?**
Under 1 ms per layer: the 20,000 layers of the Buttons page in Material 3 take about 16 seconds, and a page with 3,000 layers a few seconds. The first audit in a file can take longer while the variables of its libraries load. You can switch to another window while it runs, and it keeps going, except for that first load of library variables, which waits until Figma is back in front. **Cancel** stops it at any point.

**How do I ignore a finding?**
Click the crossed-out eye on its row, left of the fix button: that rule is ignored on that layer, for anyone who opens the file with DoD Lint. Ignored findings don't count, aren't fixed and are listed apart in the report. Click "Ignored" to see them, and the eye to bring one back. Right after ignoring, the notice at the bottom can undo it too. For text inside instances, which is listed once, it ignores that component text in all its instances.

**Where are the info findings?**
The list starts with errors and warnings. Click **Info** to see the rest: notes that don't break the Definition of Done, such as placeholder text that is a property's default value, or an instance detached from a component that was deleted. If only info findings are left, the list says the Definition of Done is met.

**Why does a row say "18 of 36 variants"?**
The same finding on the same layer in several variants of a set is listed once. Clicking the row selects all those layers, so you can fix them together in Figma; its fix button fixes them all and the eye ignores them all.

**I fixed something by hand. Do I have to audit again?**
No. When the page or a style changes after an audit, also by someone else, a bar above the results offers **Update the list**: it runs the checks again only on the layers that have findings, and on the ones fixed since the audit in case a fix was undone, and updates their rows in place. Changes made by DoD Lint itself (fixing, ignoring, saving settings) don't count. New problems on layers that had no findings only show up with a new audit.

**Are the layers inside instances checked?**
Only for what the instance changes in them: fills, strokes, padding, gap, radius, typography and text content overridden on the instance or on any layer inside it, nested instances included. The rest comes from the main component, which is checked where it's defined. The content placed in its slots is checked in full. Turn on "Go inside instances" to check everything.

Text contrast is the exception: it depends on where the instance is placed and in which mode, so the text inside every instance is checked where it sits. If the same text of a component gets the same result in several instances, it's listed once with the count.

**Why aren't the labels on my canvas checked?**
Text placed straight on the page or in a section, outside any frame, titles or annotates what's next to it and isn't part of a design. Colors, text styles, placeholders and contrast skip it; broken references are still checked.

**Are hidden layers checked?**
Hidden layers are skipped, except those a boolean component property or a variable can show: they appear as soon as someone turns them on, so they're checked anyway. Turn on "Include hidden layers" to check everything.

**Why can't this finding be fixed automatically?**
A fix is offered only when there's a single right answer. That means exactly one variable with that exact value whose scope covers that use (a frame fill, a text fill, a stroke…), exactly one semantic variable pointing to that primitive, or a broken reference to remove.

**Some fixes were skipped.**
Before applying a fix, DoD Lint checks that the layer and the variable are still as they were during the audit. If you edited the layer, applied a style or changed the variable since then, that fix is skipped. Click **Update the list**, in the bar above the results, to see where those layers stand now.

**Some text says it couldn't be evaluated for contrast.**
Text over an image, a gradient or a mixed color, or with no solid background under it, can't be measured reliably, so it's counted apart. Inside a component, the background has to be the component's own: text in a transparent component is measured where its instances are placed, not against the canvas around it.

**How do I check the dark theme?**
For components you don't need to switch modes: text inside a component is checked in every mode of the collections its colors depend on, and the finding says which mode fails ("Contrast 2.9:1 in Dark…"). Screens and documentation are checked in the mode they have, so a dark screen is checked in dark and a light one in light. A mode you set on a component, a frame or a page is respected.

**Does it work with variables from a library?**
Yes. The color and number variables of the libraries enabled in the file count like the file's own: fixes can bind them, the spacing and radius scale includes them, and primitives a library publishes are recognized. DoD Lint imports them when it opens, in the background, with Figma's team library permission. For a library of 120 variables that takes about four seconds the first time in a file and a second or two after that; an audit started before it's done waits for it, and the panel shows how many it has loaded. Importing doesn't change your file.

Figma's UI kits (Material 3, Simple Design System…) count too when the file uses one of their components, but only for what the file and its libraries don't have of their own: colors, spacing or radius. A stray Material 3 component in a file with its own colors doesn't change anything. The first time in a file, a large kit can take about ten seconds to load.

**Is DoD Lint free?**
Yes, all of it: selection, page and whole-file audits, with every check, fixes and the Markdown report.

## Privacy policy

DoD Lint doesn't collect, store or send personal data or file content. It has no network access (declared in its manifest), no analytics and no third-party services. It reads the variables of the libraries enabled in the file, through Figma, to suggest them as fixes; nothing leaves Figma.

It only stores three things:
- your language, in Figma's local plugin storage on your computer;
- the settings (rules, thresholds, primitive collections and traversal), in the file's own plugin data, so everyone who opens the file with DoD Lint audits with the same ones;
- the findings you choose to ignore, also in the file's own plugin data.

Last updated: 2 October 2026.

## Contact

Found a bug or have a question? [Open an issue](https://github.com/jm-fuster/dod-lint/issues) and include what you expected, what happened, the check involved and, if you can, the type of layer. Please don't attach confidential files. Replies usually come within a few working days.

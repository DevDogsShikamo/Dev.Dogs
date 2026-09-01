# Forms & validation

In Muten a form is **derived from an entity**, not hand-wired field by field. You declare the data shape
(`entity`), hold a draft of it in `state`, and `Form` renders one input per field, validates on submit, and
calls your action with the completed record. Accessibility is built in - you write none of it (see
[§ Accessibility](#accessibility), and the cross-cutting [accessibility guide](accessibility.md)).

## The shortest complete form

```muten
screen contact

entity Message {
  name    text  required
  email   email required
  body    text  required min:10
}

state  { draft = {} : Message  sent = [] : list<Message> }
action send(m: Message) mutates sent, draft { sent.push(m)  draft.reset() }

Page class("flex flex-col gap-4 p-6") {
  Form bind(draft) submit(send) "Send message"
}
```

- **`bind(draft)`** - the form reads and writes a single page-local `state` cell whose type is an entity.
- **`submit(send)`** - on a valid submit, the action runs with the draft as its argument (a `<- item` /
  typed-param action receives it). `draft.reset()` clears the form for free, because the bind is two-way.
- The bare string (`"Send message"`) is the submit button's label.

## Field types

`Form` maps each entity field to an input by its type:

| Entity field type | Renders | Notes |
|---|---|---|
| `text` | `<input type="text">` | the default |
| `email` | `<input type="email">` | **format-validated on submit** (see below) |
| `number` | `<input type="number">` | value is coerced with `Number()` |
| `bool` | `<input type="checkbox">` | stores a boolean |
| `enum` (`role admin \| member`) | `<select>` | one `<option>` per enum value |
| `date` | `<input type="date">` | a native date picker |
| `password` | `<input type="password">` | masked input; bound length with `min`/`max` |
| `textarea` | `<textarea>` (4 rows) | multi-line text - post body, bio, message |

> **Not a field type:** `url` / `tel` / `color` / `range`, file uploads, or a nested entity. An unknown type is
> **flagged by the oracle** (`unknown-field-type`, with a did-you-mean) - it would otherwise silently render as
> a plain text input. For an input Muten doesn't have, drop that one field to a [`Custom`](escapes.md).

## Validation - constraints on the entity field

Constraints live on the **entity** declaration, so they travel with the data shape and are enforced wherever
the entity is used. They are checked **on submit**; a failure shows a per-field message and **blocks the
action** (it never runs with invalid data).

```muten
entity Account {
  name     text  required min:2 max:40
  email    email required
  zip      text  pattern:"^\d{5}$"      # US ZIP - any regex
  age      number min:18
}
```

| Constraint | Meaning | Failure message |
|---|---|---|
| `required` | non-empty (trimmed) | `Required` |
| `min:N` / `max:N` | **number** → value bound · **text** → length bound | `Min N` / `Min N characters` (and Max) |
| `pattern:"<regex>"` | a non-empty value must match the JS regular expression | `Invalid format` |
| *(automatic)* on `email` fields | a non-empty value must look like an email | `Enter a valid email` |

`pattern` takes a normal JavaScript regex **as a string** - `pattern:"^\d{5}$"`, `pattern:"^[A-Z]{2,}$"`.
The `email` check is automatic: declaring a field `email` now validates its format (it used to only set the
input type). For a rule that spans **two** fields (`end > start`) or needs async I/O (uniqueness against the
server), do it inside the submit `action` with an `if` - and a [`use`](escapes.md) function for the async part.

### Async submit state

When the submit action does a server write (`create`/`update`/`delete`), it is async and exposes reactive
`.pending` / `.error` you can render around the form:

```muten
when send.pending { Text "Sending…" }
when send.error   { Text "Could not send: {send.error}" class("text-red-600") }
```

## Accessibility

**The compiler emits an accessible form - you write nothing for this.** Every field becomes a group:

```html
<div class="mu-field-group">
  <label class="mu-label" for="f_n7_email">Email</label>
  <input id="f_n7_email" class="mu-field" type="email"
         aria-required="true" aria-describedby="err_f_n7_email">
  <small id="err_f_n7_email" class="mu-field-error" aria-live="polite"></small>
</div>
```

What you get for free:

- A real **`<label for>`** tied to the input's `id` (never a placeholder standing in for a label).
- **`aria-required="true"`** on `required` fields, so screen readers announce them.
- The error `<small>` is linked to its input via **`aria-describedby`** and is an **`aria-live="polite"`**
  region, so a validation message is announced the moment it appears.
- Native elements (`<button type=submit>`, `<input>`, `<select>`) → keyboard and focus work with zero effort.

For an accessible widget that **isn't** an entity form (a custom dropdown, a dialog, tabs), use the
[`aria(...)`](accessibility.md#the-aria-modifier) modifier to write `aria-*`/`role` directly.

## Styling

`Form` ships **structure**, not a skin. Style it with your CSS against these classes (a baseline is scaffolded
into `src/styles.css`, override freely):

| Class | Element |
|---|---|
| `mu-form` | the `<form>` |
| `mu-field-group` | one label + control + error |
| `mu-label` | the field label |
| `mu-field` | text/email/number/select inputs |
| `mu-field-check` | a checkbox |
| `mu-field-error` | the per-field error text |
| `mu-submit` | the submit button |

`class()` on a `Form` styles the `<form>` element itself.

## Limits & escape valves

- `Form` renders **every** field, in declaration order, with **no conditional fields**. To branch, gate the
  whole `Form` with a `when`, or split the entity (e.g. a multi-step wizard = one entity per step).
- An **`enum` field cannot be `required`** (a select always has a value).
- No nested entities or field arrays inside one `Form`. For a fully bespoke form (conditional fields, per-step
  gating), don't use `Form` - build it from the [standalone inputs](#standalone-inputs--real-forms) below.

## Standalone inputs & real forms

`Form` is a shortcut: it renders **every** field, in order, and validates **only on submit** - there is no way
to put `disabled when` on its generated submit button. So **"a Save button disabled until the form is valid"
and `Form` are mutually exclusive**: the moment you need that, skip `Form` and hand-roll with standalone
inputs, a `get valid = …`, and `Button "Save" -> save disabled when not valid` (see the
[recipe below](#hand-rolled-single-record-form)). The same goes for conditional fields or per-step gating
("disable Next until this step is valid") - any live gating needs the standalone controls. The same controls a
`Form` renders are also standalone [primitives](reference/primitives.md), each two-way bound to a `state`:

| Primitive | Binds | Renders |
|---|---|---|
| `SearchField bind(q) "…"` | text | `<input type=search>` |
| `Password bind(pw) "Password"` | text | masked `<input type=password>` |
| `Select bind(role) options(founder, engineer, other) "Pick a role"` | text | `<select>` - `options` is the value list, the string is the empty prompt |
| `Checkbox bind(agree) "I accept the terms"` | bool | `<input type=checkbox>` in a clickable `<label>` |

The oracle enforces the bind type (`Password`/`Select` → a **text** state, `Checkbox` → a **bool** state); a
mismatch or a missing state is a `bind-type` error. Compose them with the pieces you already have:

- **`when`** shows/hides a field reactively - the conditional field `Form` can't do.
- A reactive **`get`** is your per-step validity: derive it once, name it, reuse it.
- **`disabled when <cond>`** gates the button on that `get` (the real, reactive `disabled` prop).

```muten
state { pw = "" : text  agree = false : bool  step = 1 : number }
get strong = pw.length >= 8
action next mutates step { if strong and agree { step.set(2) } }

Page class("flex flex-col gap-4 p-6") {
  Password bind(pw) "Password"
  when strong { Text "Strong enough" class("text-green-600") }
  Checkbox bind(agree) "I accept the terms"
  Button "Next" -> next disabled when not strong or not agree
}
```

This replaces the old hand-roll - a fake `disabled` CSS class + `aria(disabled: …)` + an in-action guard - with
one reactive `disabled when`.

**Trade-off.** Hand-rolling means the entity's declared constraints (`required`/`min`/`max`/`pattern`/the
automatic `email` check) are **not** auto-enforced anymore - there's no entity draft in the loop, so you
re-express each rule yourself in the `get` (the way `strong` re-expresses "8+ characters" above).

### Hand-rolled single-record form

`bind(x.field)` is documented only **inside `each`** (a row of a list). To hand-roll a form over ONE entity
draft, skip the entity/`state {} : Entity` draft too - hold each field as its own scalar state, validate with a
`get`, and build the record inline in the action:

```muten
entity Contact { name text required  email email required }
state { items = [] : list<Contact>  name = "" : text  email = "" : text }
get valid = name.length > 0 and email.length > 0

action save mutates items, name, email {
  items.push({ name: name, email: email })     # build the record inline - no draft entity, no bind(draft)
  name.reset()
  email.reset()
}

Page class("flex flex-col gap-3 p-6") {
  SearchField bind(name)  "Name"
  SearchField bind(email) "Email"
  Button "Save" -> save disabled when not valid
}
```

For an **edit**, `items.update({ id: c.id, name: name, email: email })` needs the row's `id` restated in the
literal - and since Muten has no object-spread, you restate **every** field, not just the one the user changed.

## Data-driven / JSON forms

When the **fields themselves are data** - a schema fetched from a server, a settings blob, a form the user
shapes - don't hand-write the controls: drive them from a `list<FieldSpec>` and render each row with `each` +
`match`. Because an inline [`bind(f.value)`](lists.md#inline-editable-list-items--bindxfield) writes back into
the source list, the schema is a **single source of truth**: editing a control patches that same `list`, and a
second `each` over it (a live JSON / preview panel) moves in lockstep - no wiring between them.

```muten
screen builder

entity FieldSpec {
  label   text
  kind    text | email | number | bool     # the enum that picks the control
  value   text
  checked bool
}

state {
  schema = [
    { id: "f1", label: "Full name", kind: "text",  value: "", checked: false }
    { id: "f2", label: "Email",     kind: "email", value: "", checked: false }
    { id: "f3", label: "Subscribe", kind: "bool",  value: "", checked: true  }
  ] : list<FieldSpec>                        # seed explicit ids -> stable rows while editing
}

Page class("flex flex-row gap-8 p-6") {
  # the generated form - one control per row, bound to that row
  List class("flex flex-col gap-3") {
    each schema as f {
      match f.kind {
        text   -> SearchField bind(f.value) "{f.label}"
        email  -> SearchField bind(f.value) "{f.label}"
        number -> SearchField bind(f.value) "{f.label}"
        bool   -> Checkbox bind(f.checked) "{f.label}"
      }
    }
  }
  # a live preview over the SAME state - updates as you type
  List class("flex flex-col gap-1") {
    each schema as f { Text "{f.label}: {f.value}" }
  }
}
```

Editing any control patches `schema` by `id`, so the form and the preview stay in sync for free.

**The honest bound.** This covers a **flat** field list (label + kind + value) - the shape of most settings
panels and JSON forms. A truly arbitrary or **deeply nested** schema (field groups, arrays of sub-forms,
conditional trees) is past what `each` + `match` should express: build it as a dedicated primitive or drop it
to a [`Custom`](escapes.md). Keep the declarative path for the flat 80%.

## See also
- [State & reactivity](state.md) - how the bound draft works.
- [Accessibility](accessibility.md) - the `aria(...)` modifier and the app-wide a11y the compiler emits.
- [Data](data.md) - `create`/`update`/`delete` for forms that write to a backend.

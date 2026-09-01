# Reference - Constraints

Constraints are validation suffixes on an **entity field**. They travel with the data shape and are enforced
on **form submit** - a failure shows a per-field message and blocks the action. See [Forms](../forms.md) for
the full form story.

```muten
entity Account {
  name  text  required min:2 max:40
  email email required
  zip   text  pattern:"^\d{5}$"
  age   number min:18
}
```

| Constraint | Syntax | Meaning | Default message |
|---|---|---|---|
| required | `required` | non-empty (trimmed) | `Required` |
| min | `min:N` | **number** → value ≥ N · **text** → length ≥ N | `Min N` / `Min N characters` |
| max | `max:N` | **number** → value ≤ N · **text** → length ≤ N | `Max N` / `Max N characters` |
| pattern | `pattern:"<regex>"` | a non-empty value must match the JS regex | `Invalid format` |

Constraints combine in any order on one field: `name text required min:2 max:40`.

**A constraint must match the field kind** - the oracle rejects a mismatch (`constraint-kind`), because a
`pattern` on a number or a `min` on a bool would silently do nothing:

- `required` → any field. On a **bool** it means *must be checked* (a consent box: an unchecked box blocks
  submit). On an **enum** it's redundant - a select always has a value - and is rejected.
- `min` / `max` → **number** (value bound) or **text** (length bound) only.
- `pattern` → **text** / **email** only.

## The automatic `email` check

Declaring a field `email` not only renders `<input type=email>` - it **validates the format on submit** (a
non-empty value that doesn't look like an email blocks the action, message `Enter a valid email`). You don't
add anything; it's part of the type.

## `pattern` - any regex

`pattern` takes a normal JavaScript regular expression **as a string**:

```muten
phone text pattern:"^\+?[0-9 ]{7,}$"
sku   text pattern:"^[A-Z]{3}-[0-9]{4}$"
slug  text pattern:"^[a-z0-9-]+$"
```

The value is checked with `new RegExp(pattern).test(value)`; an empty value passes pattern (combine with
`required` to forbid empty).

## What's NOT a field constraint

- An **`enum` field cannot be `required`** (a select always has a value).
- A rule across **two** fields (`end > start`) or **async** uniqueness is not a field constraint - do it in
  the submit `action` with an `if` (and a [`use`](../escapes.md) function for async). Muten keeps the
  declarative constraint set small on purpose; cross-field logic is action logic.

## See also
- [Forms & validation](../forms.md) · [Modifiers](modifiers.md) · [Keywords](keywords.md)

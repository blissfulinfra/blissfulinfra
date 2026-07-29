---
title: blissful-infra use
description: Set or show the current tenant and project context, so you stop retyping coordinates on every command.
---

Most commands need to know which tenant and project you mean. `use` sets that once and stores it, so you can type `blissful-infra deploy orders` instead of `blissful-infra deploy orders --tenant acme --project shop`.

```bash
blissful-infra use acme/shop
```

## Usage

```bash
blissful-infra use [target]
```

| Argument | Meaning |
|---|---|
| `<tenant>` | Set the tenant, leave the project unset |
| `<tenant>/<project>` | Set both |
| *(omitted)* | Print the current context |

## Options

| Flag | What it does |
|---|---|
| `--clear` | Clear the stored context |

## Examples

```bash
blissful-infra use acme            # tenant only
blissful-infra use acme/shop       # tenant and project
blissful-infra use                 # show what is currently set
blissful-infra use --clear         # forget it
```

## How resolution works

Commands that take tenant/project coordinates resolve them in this order:

1. An explicit `--tenant` / `--project` flag on the command
2. The context stored by `use`
3. For some commands, a registry scan: if exactly one project contains the named service, it is used

This means an explicit flag always wins, so you can reach across to another tenant for a single command without disturbing your context:

```bash
blissful-infra use acme/shop
blissful-infra status --tenant other-tenant   # one-shot, context unchanged
```

The context is stored in `~/.blissful-infra/context.json`.

## See also

- [`status`](/commands/status): see what exists across all tenants
- [`tenant`](/commands/tenant): manage tenants
- [`project`](/commands/project): manage projects

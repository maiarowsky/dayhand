# README badges

The badges at the top of the README are images from [shields.io](https://shields.io), loaded by
the reader's browser from `img.shields.io`.

| Badge | Kind | Source |
|---|---|---|
| GitHub stars | live | `https://img.shields.io/github/stars/maiarowsky/dayhand?style=flat` |
| Release | live; "no releases or repo not found" until a release exists | `https://img.shields.io/github/v/release/maiarowsky/dayhand?style=flat` |
| npm | static: not published yet | `https://img.shields.io/badge/npm-not%20published%20yet-lightgrey?style=flat` |
| Works with N agents | static, counted by hand (below) | `https://img.shields.io/badge/works%20with-2%20agents-blueviolet?style=flat` |
| License | live, from the repository (Apache-2.0) | `https://img.shields.io/github/license/maiarowsky/dayhand?style=flat` |

At npm publication, replace the static npm badge with
`[![npm](https://img.shields.io/npm/v/dayhand?style=flat)](https://www.npmjs.com/package/dayhand)`
and update this table.

There is no CI badge: `.github/workflows/` holds only the release and npm publishing workflows,
no test workflow. Add one when a CI workflow exists.

## Agents

N counts only the AI clients for which these docs give a working setup:

1. **The Claude apps** (claude.ai, Desktop, Android, iOS): custom connector with OAuth
   ([oauth.md](oauth.md), [mcp.md](mcp.md#connecting-a-client)).
2. **Claude Code**: `claude mcp add` with an API key ([mcp.md](mcp.md#connecting-a-client)) and
   `dayhand prime` as a session-start hook ([cli.md](cli.md)).

"Any other MCP client" works with the address and a Bearer header, but is not counted until a
doc shows its setup. Raise N in the README badge only together with such a doc.

## When the repository is renamed

The live badges name `maiarowsky/dayhand`. When the repository is renamed again
([rename.md](rename.md)), change that path in the README badges and in this file.

# Contributing to Unlisted

These rules apply to every commit, branch, pull request and issue in this repo, whether a person or an agent writes it. [Spec 00](docs/specs/00-agent-split.md) is the fuller statement for the agent split.

## 1. Git identity

Every commit's author and committer is `1nonlypiece <190412812+1nonlypiece@users.noreply.github.com>`. Set this in the repo, never globally:

```sh
git config user.name 1nonlypiece
git config user.email 190412812+1nonlypiece@users.noreply.github.com
```

Worktrees inherit the repo config. Don't override it.

## 2. No AI attribution lines

Commit messages, PR descriptions and issues **must not** contain:
- a `Co-Authored-By:` line;
- a "Generated with …" line, or the 🤖 marker that comes with it.

This includes attribution added by coding tools by default. `.claude/settings.json` turns off Claude Code's attribution for this repo, but the hooks below enforce the rule whatever tool writes the commit.

The hooks match these words anywhere in a message, not only in trailers. If a commit genuinely needs to say something was "generated with" a tool, reword it (for example, "IDL produced by `anchor build`").

### The scan command

Run this before every push, over every branch:

```sh
git log main program app ops --format=%B | grep -n -i -E 'co-authored-by|generated with|🤖'
```

No output means clean. After pushing, verify on GitHub itself rather than locally:

```sh
for b in main program app ops; do
  gh api "repos/Unlisted-Org/unlisted/commits?sha=$b&per_page=100" --paginate \
    --jq '.[] | [.sha, (.author.login//"NONE"), (.committer.login//"NONE"), (.commit.message|gsub("\n";" ⏎ "))] | @tsv'
done | grep -i -E 'co-authored-by|generated with|🤖'
```

Again, no output means clean. The `gsub` flattens multi-line messages so that a trailer on line 3 is still on the same row as its SHA.

### The hooks (enforcement)

`.githooks/` holds two hooks. Both share one check, `.githooks/check-commit-message`.

| Hook | Refuses |
|---|---|
| `commit-msg` | a commit whose message matches the pattern above |
| `pre-push` | a push if any commit being pushed matches the pattern, or if its author or committer isn't the 1nonlypiece identity |

`pre-push` also covers commits that skipped `commit-msg`: `--no-verify`, `commit-tree`, `filter-branch`, or commits made before the hooks existed.

Enable them once per clone. The setting lives in the shared repo config, so every worktree picks it up:

```sh
git config core.hooksPath "$(git rev-parse --show-toplevel)/.githooks"
```

The path is absolute, so worktrees on branches that don't carry `.githooks/` are still covered. Check that it's active from any worktree with `git config core.hooksPath`.

Never bypass the hooks with `--no-verify`. If a hook refuses, fix the message:
- **the last commit:** `git commit --amend`;
- **older unpushed commits:** `git filter-branch --msg-filter` over the unpushed range, then confirm the tree hash is unchanged.

**Verified 2026-09-25:**
- With the hooks disabled, a commit carrying a `Co-Authored-By` trailer was accepted, and a dry-run push would have created the branch.
- With the hooks enabled:
  - `commit-msg` refused both the trailer and a "Generated with" line, and accepted a clean message.
  - A real push of a trailered commit was refused, and GitHub returned 404 for the branch.
  - A push of a commit with a wrong author was refused.
  - A dry-run push of `ops` (clean) went through.

## 3. Pushing

Push as 1nonlypiece by passing its token for that one command. Never switch the machine's active `gh` account, and never write credentials to git or gh config:

```sh
export GH_TOKEN=$(gh auth token --user 1nonlypiece) \
  && AUTH=$(printf "x-access-token:%s" "$GH_TOKEN" | base64) \
  && git -c credential.helper= -c http.https://github.com/.extraheader="AUTHORIZATION: basic $AUTH" push origin <branches>
unset GH_TOKEN AUTH
```

## 4. Tests: the broken version comes first

This is a requirement, not a suggestion. Before a test counts toward anything, run it against a deliberately broken version of the thing it tests, confirm it **fails**, and record the mutation and the failing output next to the test. See [spec 00](docs/specs/00-agent-split.md#required-the-broken-version-comes-first).

## 5. Devnet only

Never sign a mainnet transaction. Never use `~/.config/solana/id.json` or any key under `~/.config/solana/uncross/`; they belong to another project. Record a new test wallet's key before funding it.

# gme - English Git Commit

Read all staged changes in the current repository, analyze them, and create a Conventional Commits message **in English**, then commit.

## Workflow

1. Run `git status` and `git diff --staged` to inspect all staged content, and also check for unstaged (modified / untracked) changes
2. If nothing is staged, tell the user "no staged changes" and do not commit; also list what unstaged changes exist and ask whether to stage and commit them too
3. Analyze the nature and scope of the changes, pick the appropriate commit type
4. **If unstaged changes exist, ask the user first**: list those files and ask whether to `git add` them before committing. Until the user confirms, do not add unstaged files and do not commit (unless the user explicitly says to commit only what is staged)
5. Write the commit message in English, formatted as `<type>: <description>`
6. Run `git commit` to complete the commit

## Commit Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Code formatting (no functional change)
- `refactor`: Code refactoring (not a feature or fix)
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Build, dependencies, config, and other chores
- `ci`: CI/CD changes

## Commit Message Format

```
<type>: <english description>
```

Examples:
- `feat: add user login endpoint`
- `fix: resolve pagination off-by-one error`
- `docs: update installation steps in README`

Requirements:
- Description in concise, imperative English (e.g. "add", "fix", "update")
- Type stays lowercase, with one space after the colon
- If changes span multiple areas, pick the dominant type and summarize; add bullet details in the body when needed
- Do **not** run `git add` on unstaged files without the user's explicit confirmation

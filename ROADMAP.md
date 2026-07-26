# Fork roadmap

## Shipped in the current task

- Convert all 97 current Copilot simulation cache databases from Git LFS pointers to Desktop Material Cheap LFS pointers without rewriting history.
- Publish and verify one release asset for each migrated database.
- Add a safe, repository-aware **Git: Open in Desktop Material** command to the built-in Git extension.
- Add a directly accessible, bounded regex builder to the Search view.
- Replace desktop modal decision presentation with keyboard-first notification actions while retaining custom/native compatibility, awaited cancellation semantics, Quick Input text entry, native file pickers, and bounded session-only notification history.
- Adopt quiet defaults for startup, onboarding, walkthroughs, recommendations, tips, surveys, release notes, experiments, and Workspace Trust presentation without auto-granting trust.

## Verification and delivery

- Keep the passing focused unit, compilation, style, typecheck, and isolated headless workbench acceptance checks green.
- Keep notification/custom/native compatibility covered; the default notification style, keyboard focus, history surface, and quiet untrusted-workspace startup are verified in fresh isolated desktop profiles.
- Prove a fresh clone can materialize all 97 Cheap LFS objects and reproduce every recorded digest.
- Push the default branch, update the fork wiki and Pages source, and record the exact GitHub Actions and release results.

## Later work

- Evaluate optional Cheap LFS compression only through Desktop Material's reviewed workflow and consent model.
- Reconcile future upstream changes to the Git extension menus and process-launch APIs while keeping shell-free launch guarantees.
- Retain historical Git LFS objects for old commits unless maintainers explicitly approve a separately reviewed history migration.

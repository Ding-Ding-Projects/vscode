# Fork roadmap

## Shipped in the current task

- [x] Convert all 97 current Copilot simulation cache databases from Git LFS pointers to Desktop Material Cheap LFS pointers without rewriting history.
- [x] Publish and verify one release asset for each migrated database.
- [x] Add a safe, repository-aware **Git: Open in Desktop Material** command to the built-in Git extension.
- [x] Add a directly accessible, bounded regex builder to the Search view.
- [x] Replace desktop modal decision presentation with keyboard-first notification actions while retaining custom/native compatibility, awaited cancellation semantics, Quick Input text entry, native file pickers, and bounded session-only notification history.
- [x] Adopt quiet defaults for startup, onboarding, walkthroughs, recommendations, tips, surveys, release notes, experiments, and Workspace Trust presentation without auto-granting trust.
- [x] Fast-forward the primary `main` branch to `b85037078ab7bbe2c632c211a21fbf326457fb09` and verify the remote reference.

## Verification and delivery

- [x] Keep the passing focused unit, compilation, style, typecheck, and isolated headless workbench acceptance checks green.
- [x] Keep notification/custom/native compatibility covered; the default notification style, keyboard focus, history surface, and quiet untrusted-workspace startup are verified in fresh isolated desktop profiles.
- [ ] Prove a fresh clone can materialize all 97 Cheap LFS objects and reproduce every recorded digest.
- [ ] Update the fork wiki and Pages source, and record the exact GitHub Actions and release results.
- [x] Inventory the primary checkout, linked checkouts, stashes, and unmerged entries, preserving all recoverable work.
- [x] Verify that no linked checkout, stash, or ownership-uncertain cleanup candidate was removed.

## Later work

- [ ] Evaluate optional Cheap LFS compression only through Desktop Material's reviewed workflow and consent model.
- [ ] Reconcile future upstream changes to the Git extension menus and process-launch APIs while keeping shell-free launch guarantees.
- [ ] Retain historical Git LFS objects for old commits unless maintainers explicitly approve a separately reviewed history migration.

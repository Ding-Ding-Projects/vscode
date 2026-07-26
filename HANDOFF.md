# Handoff

Updated: 2026-07-26

## Completed locally

- Commit `e4c61a474e160df1cb45a7f3438b7c3f9ecf72a9` converts all 97 current Copilot simulation cache databases to Desktop Material Cheap LFS pointers.
- The immutable `desktop-material-cheap-lfs-v1` published prerelease contains 97 corresponding assets totaling 272,318,464 bytes and points to the migration commit.
- Local source bytes, old Git LFS OIDs, new pointer digests, asset digests, and declared sizes were cross-checked with no mismatch.
- The built-in Git extension has a repository-aware **Git: Open in Desktop Material** implementation and focused process-safety tests.
- The Search view has an accessible regex builder with a bounded JavaScript preview worker and direct Search-state synchronization.
- Client typechecking, targeted ESLint, the repository style runner, full workbench compilation, Git-extension compilation, Copilot bundling, 33 focused workbench browser tests, and six Desktop Material integration tests pass.
- An isolated headless Code OSS Dev profile exercised the regex builder in the real Search view: two local named-capture matches synchronized to a 29-result workspace search across 10 files.
- The same trusted headless workbench exposed **Git: Open in Desktop Material** from the built-in Git extension's Command Palette contribution.
- The installed Desktop Material executable reports product version `3.6.3-beta3-zadtuyunxj`; it accepted `--cli-open` in a separate headless profile, selected the isolated acceptance clone, and detected its Cheap LFS pointers.
- An isolated fresh-profile Windows run verified that an unsaved-file decision appears as an actionable notification, focus moves into the notification after its render frame, **Tab** reaches **Don't Save**, and **Enter** completes the operation without editing the document.
- The same run verified the bounded session-only Notification History command, and a second fresh untrusted workspace opened directly in Restricted Mode without a trust prompt, Restricted Mode banner, Welcome editor, or onboarding surface.
- GitHub Discussions is enabled and the rolling progress record is [Desktop Material + Cheap LFS integration progress](https://github.com/Ding-Ding-Projects/vscode/discussions/1).

## Pending verification

- Commit the remaining source and documentation changes, push `main`, and prove the remote default branch contains the full delivery.
- Clone the pushed public revision through Desktop Material's public-clone flow and verify materialization for all 97 Cheap LFS pointers. A signed-out repository added locally is detected, but lacks the GitHub Release account metadata needed to start materialization.
- Record the triggered GitHub Actions installer/release outcome, publish the `/docs` Pages source, and synchronize the fork wiki.

## External state

- GitHub Issues are disabled on this fork, so there is no fork issue queue to triage.
- The six open Desktop Material issues were read in full. None is a prerequisite for this task: three are separate product/capture work, two are blocked on concurrent work or external decisions, and the shipped tab-overflow fix awaits its own live acceptance evidence. The dirty sibling checkout was not changed.
- GitHub Projects are intentionally skipped for this delivery at the user's explicit direction. Existing Projects were not inspected or changed.
- Repository release immutability is an externally configured publishing prerequisite and the GitHub administration endpoint reported it enabled on 2026-07-26. The automatic Actions token cannot read that admin-only setting, so the release job uses GitHub CLI's draft/upload/publish flow and then fails closed unless the published release reports `immutable: true`, has one exact installer asset, and its tag points directly to the tested commit.
- The sibling Desktop Material checkout contains unrelated user work and was kept read-only.

### Open-issue scan

| Repository issue | Result for this task |
| --- | --- |
| `desktop-material#39` | Relevant code is already being changed in the dirty sibling checkout; do not overwrite it. Not required by this integration. |
| `desktop-material#35` | Separate Cheap LFS performance tranche; current release-backed correctness is unaffected. |
| `desktop-material#34` | Separate submodule branch-picker feature. |
| `desktop-material#25` | Blocked on a product decision and external capture accounts. |
| `desktop-material#23` | Separate screenshot replacement campaign. |
| `desktop-material#22` | Implementation is shipped; its issue remains open for real tab-overflow capture evidence. |

## Historical compatibility

No history was rewritten. Current `HEAD` has zero Git LFS-managed paths; historical commits still depend on Git LFS. Do not delete historical LFS data or the immutable `desktop-material-cheap-lfs-v1` release. The legacy mutable `assets` release is retained only as a historical migration source; no current pointer references it.

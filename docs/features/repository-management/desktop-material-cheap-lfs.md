---
layout: default
title: Desktop Material Cheap LFS
---

# Desktop Material Cheap LFS

The current tree stores every Copilot simulation cache database with Desktop Material Cheap LFS. Cheap LFS is Desktop Material's release-backed pointer protocol; it is intentionally different from Git LFS.

## Current inventory

| Property | Value |
| --- | ---: |
| Tracked pointers | 97 |
| Materialized byte total | 272,318,464 bytes |
| Backing release tag | `desktop-material-cheap-lfs-v1` |
| Backing assets | 97 uploaded assets |
| Current-tree Git LFS entries | 0 |
| Migration commit | `e4c61a474e160df1cb45a7f3438b7c3f9ecf72a9` |

The published [Desktop Material Cheap LFS v1 prerelease](https://github.com/Ding-Ding-Projects/vscode/releases/tag/desktop-material-cheap-lfs-v1) is immutable, contains exactly 97 assets, and points directly to migration commit `e4c61a474e160df1cb45a7f3438b7c3f9ecf72a9`. Every uploaded asset was checked against the size and SHA-256 recorded by the former Git LFS pointer before the working tree was converted. The earlier mutable `assets` prerelease is retained only as a historical migration source and is not referenced by the current tree.

## Pointer format

Each tracked `.sqlite` path now contains a small LF-normalized text blob:

```text
version desktop-material/cheap-lfs/v1
release-tag desktop-material-cheap-lfs-v1
asset-name <release asset name>
size <decimal byte count>
sha256 <64 lowercase hexadecimal characters>
```

`extensions/copilot/.gitattributes` deliberately no longer applies `filter=lfs`, `diff=lfs`, or `merge=lfs` to these files. Applying a Git LFS clean filter to a Cheap LFS pointer would incorrectly wrap one pointer protocol inside the other.

The release asset label additionally records the Cheap LFS version, digest, migration commit, and repository-relative path for an auditable inventory. The pointer itself remains the source of truth.

## Materialization

A normal Git clone receives pointer text. Open the repository in Desktop Material, open **Large files**, and choose **Materialize all**. Desktop Material downloads each named asset, checks its declared byte count and SHA-256, and only then atomically replaces the working-tree pointer with the original database bytes.

Opening the repository through **Git: Open in Desktop Material** provides the same repository context. Desktop Material can also materialize automatically when its **Download large files after cloning** preference is enabled.

Ordinary Git clients remain usable but see pointer text until Desktop Material materializes it. Do not edit a pointer by hand or rename a release asset independently of its committed pointer.

## Historical boundary

This migration is forward-only and does not rewrite published Git history. The current tree has no Git LFS entries, but older commits still contain Git LFS pointers and require access to their historical Git LFS objects. This preserves commit identities and avoids a force-push.

The migration therefore reduces new current-tree reliance on Git LFS; it does not erase old Git LFS storage or promise a billing change for historical objects.

## Failure modes

- **Desktop Material is not installed:** the clone remains valid and displays pointer text.
- **Release or asset is inaccessible:** materialization fails closed and leaves the pointer intact.
- **Size or SHA-256 differs:** the downloaded bytes are rejected and never replace the tracked path.
- **A historical revision is checked out:** use Git LFS for that revision.
- **A pointer was edited or an asset renamed:** restore the committed pointer or matching immutable asset metadata before retrying.
- **A path is unsafe or crosses repository metadata:** Desktop Material rejects the materialization target.

## Security and retention

- The backing release is a published prerelease in the same public GitHub repository.
- Hash and size verification are mandatory; asset names alone are never trusted as content proof.
- Restoration uses owned temporary files and an atomic final replacement.
- Paths are repository-relative and must not traverse parents or Git metadata.
- Release assets are retention-critical. The `desktop-material-cheap-lfs-v1` assets and associated tag are protected by GitHub release immutability; never delete the release while a reachable commit points to it.
- Historical Git LFS objects remain the rollback source for old commits.

## Verification

The migration verification checks all three representations for every path:

1. the old Git LFS object identifier and declared size;
2. the committed Cheap LFS `sha256` and `size` fields;
3. the GitHub Release asset digest and byte count.

All 97 triples matched, totaling 272,318,464 bytes. `git lfs ls-files --name-only` returns no entries at the current `HEAD`, and `git check-attr` confirms that the SQLite paths have no active Git LFS filters. A fresh-clone acceptance check should materialize all pointers through Desktop Material and compare the restored bytes with the committed digests.

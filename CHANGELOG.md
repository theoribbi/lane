# Changelog

# [0.2.0](https://github.com/theoribbi/lane/compare/lane@0.1.1...lane@0.2.0) (2026-06-26)


### Bug Fixes

* rename plugin marketplace lane-dev -> lane ([2225e4b](https://github.com/theoribbi/lane/commit/2225e4b6b08a8a94afce33499953b5d9a00d22d6))


### Features

* --no-deps on start + configurable compose path ([a92108a](https://github.com/theoribbi/lane/commit/a92108a7a2fa7bd2d0de2deabedddeab3a81be07))

## [0.1.1](https://github.com/theoribbi/lane/compare/lane@0.1.0...lane@0.1.1) (2026-06-26)

# 0.1.0 (2026-06-26)


### Bug Fixes

* persist repo root + db creds in EnvRecord; engine-correct drop; narrow worktree-add swallow ([a202c15](https://github.com/theoribbi/lane/commit/a202c152192c83e7df802de71c44ae7a1f637211))


### Features

* CLI wiring (up/down/list/prune/init) and manifest bootstrap ([973cf7c](https://github.com/theoribbi/lane/commit/973cf7c3d529dfaa9fa2168f58ff9a2f19ce546e))
* clone and drop databases via docker exec (postgres + mysql) ([2aff648](https://github.com/theoribbi/lane/commit/2aff64808f9bb9e6ff127b8a573dacc878cf3529))
* cross-repo dependency resolution and DB url builder ([6569533](https://github.com/theoribbi/lane/commit/65695336ceb59193ee7a436d78e5d1275206e6a2))
* down teardown with cleanliness safety gate ([474ce86](https://github.com/theoribbi/lane/commit/474ce86f4c3ff0d1af1f61ad9d2389c9bbd1d224))
* generate .env and compose override from manifest + env record ([98d6f7a](https://github.com/theoribbi/lane/commit/98d6f7aaaf4da9fa465e8a96fbb3a354518bddce))
* generated env registry under ~/.lane with slugify ([28c7b0b](https://github.com/theoribbi/lane/commit/28c7b0b8ee603bded3aa4baeb1bb34000c8164ed))
* git worktree add/remove with cleanliness gate ([e6abbe5](https://github.com/theoribbi/lane/commit/e6abbe5e543fe3a81fe2b5bbe1c2cee3c01f6b54))
* list active envs and prune orphaned compose projects ([d63fc92](https://github.com/theoribbi/lane/commit/d63fc9220f7fccffb36938ed7a4f0f727d6fca42))
* load and validate lane.yml manifests ([97bfee4](https://github.com/theoribbi/lane/commit/97bfee471012e6f1423f9f84d40e6648837b0e40))
* make lane installable as a Claude Code plugin ([a623eac](https://github.com/theoribbi/lane/commit/a623eacc08d242854d889ea44049967c92391802))
* offset allocation and port probing ([6f4000a](https://github.com/theoribbi/lane/commit/6f4000a9fd99f0cf77af12c7d5e7234565b70adb))
* ship Claude Code skill for lane workflow ([2349f11](https://github.com/theoribbi/lane/commit/2349f1173876755ea4c692bf0e64515da891399f))
* up orchestration — worktrees, db clone, generated config, start ([e1c8d1d](https://github.com/theoribbi/lane/commit/e1c8d1d3d79ea6a7877e33c4b5232e7197c8b0d8))

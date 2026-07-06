# Changelog

本项目版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

## [2.5.2] — 2026-07-06

### 修复

- **视频热点图标显示为长静态图**：`utils.xml` 模板中 `hotspot_video` style 缺少 `onloaded="do_crop_animation(86,86,24);"` 调用，导致 86×2064 的序列帧图被静态整体显示，而不是按 86×86 一帧循环播放动画。已补全 onloaded 调用，与项目实际版本一致。

## [2.5.1] — 2026-07-04

### 修复

- **视频热点图标在老项目升级后丢失**：`shiping2.png` 文件未包含在 pano-cli 模板目录中，`pano upgrade` 会用模板覆盖项目的 `panohper/`，导致老项目升级后视频热点图标资源缺失、编辑器中“视频图标”选项预览加载失败。已将 `shiping2.png` 加入模板 `panohper/assets/hotspots/`。
- **`hotspot_video` style 资源路径不统一**：`utils.xml` 中引用 `panohper/assets/animate/shiping2.png`，而 `editor.js` 引用 `panohper/assets/hotspots/shiping2.png`，且 `assets/animate/` 目录不在模板中。已统一为 `panohper/assets/hotspots/shiping2.png`。

## [2.5.0] — 2026-07-04

### 新增

- **视频热点专用图标**：热点图标选择列表新增“视频图标”（基于 `shiping2.png` 序列帧动画），适合播放视频类热点。
- **播放视频热点支持拖拽上传**：视频热点的上传区域现在支持直接拖拽视频文件进行上传，与绿幕讲解热点的行为一致。
- **`enableDragDrop` 通用拖拽工具函数**：抽取视频热点和绿幕热点中重复的 dragenter/dragover/dragleave/drop 事件绑定逻辑，减少约 30 行重复代码。

### 修复

- **绿幕讲解自动播放功能无法工作**：
  - `tour.xml` 模板缺少 `panohper/greenscreen_manager.xml` 的 `<include>` 引用，导致自动播放管理器未加载。已补全 include。
  - krpano videoplayer.js 的 `play()` action 不直接生效，改用 `togglepause()` 切换播放状态。
  - 浏览器自动播放策略会随机暂停未静音视频，在 `greenscreen_auto_update` 中加入“保持播放”逻辑，检测到当前讲解员被暂停时重新触发播放。
- **添加热点面板切换类型 tab 后图标 grid 被滚出视口**：从“跳转场景”（含长场景列表）切换到“播放视频”等类型时，面板 body 未重置滚动位置，导致“热点图标”grid 渲染到视口外（y=-163）。在 `onTypeChange` 回调中加入 `body.scrollTop = 0`。

### 变更

- **绿幕讲解自动播放策略调整**：遵循浏览器自动播放策略，未获用户交互前不再静音自动播放（避免“有画面无声音”误导用户）。用户首次点击任意讲解员后设置 `autoplay_unlocked=true`，此后转动视角到讲解员附近会自动切换播放（带原声音）。此策略同时回退了 xml-gen.js 中强制 `muted="true"` 的临时方案，恢复遵循用户配置的 muted 设置。

## [2.4.7] — 2026-06

- 修复 multires 解析问题
- 修复 GBK 编码导致的文件名问题
- 验证场景分组和 multires 值

## [2.4.0] — 2026-04

- 新增 `pano publish --compress-images` 选项
- 新增 `pano sync --force-scene` 选项支持指定场景重新生成瓦片
- 新增 `pano init --repair` 选项补齐缺失的框架文件
- 编辑器：新增排序管理、全局视野、场景设置面板

## [2.3.0] — 2026-03

- 新增绿幕讲解热点类型（editor_type="greenscreen"）
- 新增 `panohper/greenscreen_manager.xml` 自动播放管理器
- 编辑器：支持热点拖拽移动、绿幕参数实时预览

## [2.2.0] — 2026-02

- 新增播放视频热点类型（editor_type="video"）
- 新增信息面板热点类型（editor_type="info"）
- 新增打开链接热点类型（editor_type="link"）

## [2.1.0] — 2026-01

- 新增 `pano serve --edit` 可视化编辑器
- 支持设为默认视角、热点管理、场景设置

## [2.0.0] — 2025-12

- 重构为 ESM 模块
- 新增 `pano dev` 本地模块链接
- 新增 `pano upgrade` 框架文件升级

## [1.x] — 2025-11

- 初始版本
- 支持 create / init / sync / xml / serve / publish 基础命令

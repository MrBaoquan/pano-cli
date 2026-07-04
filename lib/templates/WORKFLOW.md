# 全景项目工作流程

## 项目结构

```
vtour/
├── scenes.config.json        # 分组、场景配置
├── tour.xml                  # 框架入口（pano upgrade 会覆盖，勿手动编辑）
├── main.xml                  # 项目自定义逻辑（不会被覆盖）
├── scenes.xml                # 场景定义（自动生成，勿手动编辑）
├── hotspots/                 # 热点数据（按场景文件名存储）
├── skin/
│   ├── vtourskin.xml         # krpano 默认皮肤
│   ├── groups.xml            # 分组栏逻辑（自动生成）
│   └── groups_data.xml       # 分组按钮数据（自动生成）
├── panos/                    # 切片瓦片（自动生成）
├── panohper/                 # 全景交互组件库
│   ├── utils.xml             # 热点样式 & 动画 action
│   ├── popup.xml             # 图文弹窗
│   ├── videoplayer.xml       # 视频播放器
│   ├── tips.xml              # 滑动提示
│   ├── scene_groups.xml      # 分组过滤框架（配合 groups_data.xml）
│   ├── nav_styles.xml        # 导航 UI 样式覆盖
│   └── plugins/              # JS 插件（scrollarea、videoplayer 等）
└── .multires_cache.json      # 瓦片分辨率缓存
```

## 核心概念

- **热点按文件名绑定**：`hotspots/餐厅1.xml` 对应源文件 `餐厅1.jpg`，与分组无关
- **场景排序由文件夹决定**：`scenes.config.json` 中的 `groups` 定义分组和文件夹映射
- **分组栏有两份自动产物**：`skin/groups.xml` 负责分组逻辑，`skin/groups_data.xml` 负责按钮文案和 groupid
- **两种模式**：
  - **Include 模式**（正常运行）：`tour.xml` 通过 `<include url="scenes.xml" />` 加载场景
  - **Editor 模式**（编辑热点）：场景内联到 `tour.xml`，供 VTour Editor 可视化编辑

## 构建命令

```bash
cd vtour

pano init             # 首次初始化 tour.xml 结构
pano init --repair    # 修复缺失的框架文件（不重新生成瓦片）
pano sync             # 生成瓦片 + 更新 XML（新增全景图后用）
pano sync --force     # 强制重新生成所有瓦片
pano sync --force-scene 化启未来-6  # 强制重新生成指定场景瓦片
pano sync --force-scene 化启未来-6 元素探源-2  # 强制重新生成多个指定场景瓦片
pano xml              # 仅更新 XML（不生成瓦片）
pano editor           # 进入编辑模式（内联场景到 tour.xml）
pano save             # 保存热点 + 恢复 include 模式
pano clean            # 清除旧瓦片数据
pano publish          # 打包发布文件
pano publish --skip-panos          # 不打包 panos/，适用于瓦片未变化的增量发布
pano publish --compress-images     # 压缩发布包中的非全景图片资源
pano publish --oss    # 打包发布文件（瓦片指向 OSS）
pano serve            # 启动本地预览服务器
pano serve --edit     # 启动编辑模式（可视化编辑视角和热点）
pano upgrade          # 升级内置框架文件
```

通用选项：`--verbose`（详细输出）、`--quiet`（仅警告和错误）

## 常用工作流

### 1. 可视化编辑（推荐）

```bash
pano serve --edit     # 启动编辑模式
# 浏览器中：
#   设为默认视角 — 将当前视角保存为场景默认视角
#   热点模式 — 编辑 / 预览切换；编辑模式点击热点只打开编辑面板
#   添加热点 — 点击画面放置跳转、图文、链接、视频或绿幕讲解热点
#   管理热点 — 查看、编辑、删除当前场景热点
#   场景设置 — 修改当前场景标题、fovmin / fovmax
#   全局视野 — 设置项目默认 fovmin / fovmax
#   排序管理 — 拖拽调整分组和场景顺序
#   生成 XML — 将修改写入 scenes.xml / groups_data.xml
```

热点模式说明：

- `编辑`：左键打开热点编辑面板，拖拽移动热点；点击任何类型热点都不会跳转或播放。
- `Ctrl + 点击`：在编辑模式下临时执行热点真实行为。
- `预览`：左键执行热点真实行为，用于检查跳转、图文、链接、视频效果。

视频热点说明：

- `播放视频` 支持上传本地视频或填写远程视频 URL。
- 连续打开多个视频或关闭视频弹层时，旧视频会自动停止并释放，避免多个声音叠加。
- 若上传的视频资源已存在，编辑器会提示取消、覆盖或改名保存。

### 2. 传统编辑热点

```bash
pano editor           # 场景内联到 tour.xml
# 用 VTour Editor 编辑热点...
pano save             # 提取热点到 hotspots/，恢复 include 模式
```

### 3. 新增全景图

1. 将 `.jpg` 文件放入全景图源目录对应分组文件夹
2. 如需改标题，更新 `scenes.config.json` 的 `sceneOverrides`
3. 运行 `pano sync`

### 4. 调整分组/排序

1. 先保存热点（如果处于编辑模式）：`pano save`
2. 移动全景图 `.jpg` 文件到新的分组文件夹
3. 更新 `scenes.config.json` 的 `groups`
4. 运行 `pano xml`

### 5. 修改场景标题

1. 编辑 `scenes.config.json` 中的 `sceneOverrides`
2. 运行 `pano xml`

## 注意事项

- `scenes.xml`、`skin/groups.xml`、`skin/groups_data.xml` 是自动生成的，**不要手动编辑**
- **编辑热点前**必须 `editor`，**编辑完成后**必须 `save`
- `save` 会自动调用 `xml`，重新生成 `scenes.xml`、`skin/groups.xml`、`skin/groups_data.xml`
- `publish` 仅支持 Include 模式；如果当前 `tour.xml` 已内联场景，先运行 `pano save`
- `publish` 会自动重新生成 `scenes.xml`、`skin/groups.xml`、`skin/groups_data.xml`
- 如果只修改热点、标题、分组、UI 或图文资源，可使用 `pano publish --skip-panos` 做增量发布；此时服务器上已有的 `panos/` 目录必须保留
- 图文热点图片较大时，可使用 `pano publish --compress-images` 在发布阶段压缩非全景图片，不改动源文件
- 热点文件 `hotspots/*.xml` 可以手动编辑，也可以通过 VTour Editor 可视化编辑

## panohper 开发与贡献

panohper 是内置在 pano-cli 中的全景交互组件库，源码仓库：https://github.com/MrBaoquan/panohper

### 本地开发

使用 `pano dev` 命令将本地 panohper 源码仓库链接到当前项目：

```bash
# 克隆 panohper 源码
git clone https://github.com/MrBaoquan/panohper.git

# 将当前项目的 panohper/ 链接到本地源码
pano dev panohper /path/to/panohper

# 查看链接状态
pano dev --status

# 开发完成后恢复为内置版本
pano dev --reset panohper
```

链接后，对源码仓库的修改会实时反映到当前项目中。

### 贡献流程

1. Fork 或克隆 panohper 仓库
2. 在某个全景项目中用 `pano dev panohper <path>` 链接本地仓库
3. 修改、测试（`pano serve` 实时预览）
4. 提交 PR 到 panohper 仓库
5. panohper 合并后，pano-cli 发布新版本将自动更新内置副本

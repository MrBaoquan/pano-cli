# @mrbaoquan/pano-cli

krpano 全景项目 CLI 工具 — 一键创建、构建、编辑、预览、发布全景漫游。

[版本变更说明](./CHANGELOG.md)

## 安装

```bash
npm install -g @mrbaoquan/pano-cli
```

## 更新

```bash
npm update -g @mrbaoquan/pano-cli
```

## 快速开始

```bash
# 1. 设置全局 krpano 路径（只需一次）
pano config --global --krpano "F:\path\to\krpano-1.20.12"

# 2. 创建项目
pano create my-tour

# 3. 将全景图 .jpg 放入 panoramas/ 下的子文件夹
#    如: panoramas/1-展厅A/  panoramas/2-展厅B/

# 4. 初始化工程（自动生成 vtour 目录、瓦片、XML）
cd my-tour
pano init

# 5. 本地预览
pano serve
```

> 所有命令支持在**项目根目录**或 **vtour/** 目录下运行。

---

## 命令参考

### `pano create <name>`

创建新全景项目骨架。

```bash
pano create my-tour
```

交互式提示输入 krpanotools 路径（已设置全局配置时回车即可使用全局值）。

创建的目录结构：

```
my-tour/
├── vtour/
│   ├── scenes.config.json    # 项目配置
│   ├── tour.xml              # krpano 主配置
│   ├── hotspots/             # 热点数据
│   └── WORKFLOW.md           # 工作流说明
├── panoramas/default/        # 全景图存放目录
├── .gitignore
└── README.md
```

---

### `pano init`

首次初始化工程。自动完成：

- 扫描 `panoramas/` 目录结构，同步 groups 到 `scenes.config.json`
- 调用 krpanotools 生成 vtour 基础文件（tour.html、skin/、plugins/）
- 复制内置 panohper UI 库
- 生成全部场景瓦片
- 生成 `scenes.xml`、`skin/groups.xml`、`skin/groups_data.xml`

```bash
pano init
pano init --repair
```

> 如已存在 `tour.html` 会跳过，需重新初始化请先删除相关文件。
> `--repair` 仅补齐缺失的框架文件，不重新生成瓦片，适合升级后修复项目结构。

---

### `pano sync [--force] [--force-scene <name...>]`

增量同步：扫描新增全景图、生成瓦片、更新 XML。

```bash
pano sync          # 仅处理新增图片
pano sync --force  # 强制重新生成所有瓦片
pano sync --force-scene 化启未来-6                # 强制重新生成单个场景瓦片
pano sync --force-scene 化启未来-6 元素探源-2    # 强制重新生成多个指定场景瓦片
```

---

### `pano xml`

仅更新 XML（不生成瓦片），适用于修改分组、标题后快速刷新。

```bash
pano xml
```

会同步更新：

- `vtour/scenes.xml`
- `vtour/skin/groups.xml`
- `vtour/skin/groups_data.xml`

---

### `pano editor`

进入编辑模式 — 将场景内联到 tour.xml，方便在 krpano 编辑器中拖拽热点。

```bash
pano editor
```

---

### `pano save`

保存编辑模式中的热点修改，恢复 include 模式。

```bash
pano save
```

`pano save` 会自动重新生成 `scenes.xml`、`skin/groups.xml`、`skin/groups_data.xml`。

---

### `pano serve [-p <port>] [--edit]`

启动本地 HTTP 预览服务器。

```bash
pano serve            # 默认端口 8090
pano serve -p 3000    # 指定端口
pano serve --edit     # 开启可视化编辑器
pano serve -e -p 8092 # 指定端口 + 编辑器
```

自动处理端口冲突（向上递增尝试）。

**`--edit` 编辑模式** 会在浏览器中注入编辑器面板，无需插件即可完成以下操作：

| 功能         | 说明                                                               |
| ------------ | ------------------------------------------------------------------ |
| 设为默认视角 | 保存当前视角（ath/atv/fov）到 `sceneOverrides`                     |
| 热点模式     | 在“编辑 / 预览”之间切换；编辑模式只编辑热点，预览模式执行真实行为  |
| 场景设置     | 修改当前场景标题，以及当前场景的 `fovmin / fovmax` 覆盖            |
| 全局视野     | 单独维护项目级默认 `fovmin / fovmax`，供所有场景继承               |
| 热点管理     | 添加、编辑、删除场景热点，支持跳转 / 图文 / 链接 / 视频 / 绿幕讲解 |
| 排序管理     | 拖拽调整分组顺序及组内场景顺序，保存后重新生成 XML                 |
| 生成 XML     | 重新扫描并生成 `scenes.xml` + `skin/groups_data.xml`               |

**热点图标**：添加/编辑热点时可选择 9 种内置图标样式 — 默认箭头、前进(白)、前进(720)、右转、左转、无人机、光点(大)、光点(小)、视频图标。其中“视频图标”适合播放视频类热点。

### 编辑模式补充说明

- **热点模式**
  - `编辑`：左键打开热点编辑面板，拖拽移动热点；点击任何类型热点都不会跳转或播放
  - `Ctrl + 点击`：在编辑模式下临时执行热点真实行为，便于快速检查
  - `预览`：左键直接执行热点真实行为，适合检查跳转/图文/链接/视频效果
- **场景设置**
  - 场景标题保存后会立即刷新当前场景运行时标题和编辑器场景列表
  - 当前场景 `fovmin / fovmax` 留空时，表示继承“全局视野”中的默认值
- **热点类型**
  - `跳转场景`：点击后切换到目标场景
  - `信息面板`：弹出图文/图片/音频/二维码信息面板
  - `打开链接`：弹窗嵌入网页，并提供“新标签页打开”回退按钮
  - `播放视频`：点击后弹窗播放本地或远程视频资源，关闭或切换视频时会停止旧视频声音。支持拖拽视频文件到上传区域
  - `绿幕讲解`：以热点形式播放抠像视频，支持位置拖拽和参数编辑。**自动播放策略**：未获用户交互前不自动播放（避免静音播放误导），用户首次点击任意讲解员后解锁自动播放权限，此后转动视角到讲解员附近会自动切换播放

---

### `pano config [options]`

查看或修改配置。

```bash
# 查看项目配置
pano config

# 设置项目 krpanotools 路径
pano config --krpano "F:\path\to\krpano"

# 设置全景图源目录
pano config --source "../panoramas"

# 查看全局配置
pano config --global

# 设置全局 krpanotools 路径（所有项目共享）
pano config --global --krpano "F:\path\to\krpano"
```

**配置优先级**：项目 `scenes.config.json` > 全局 `~/.pano-cli/config.json`

---

### `pano clean`

清除旧瓦片数据（已删除场景对应的 .tiles 目录）。

```bash
pano clean
```

---

### `pano upgrade [--check]`

升级 CLI 内置框架文件，不覆盖项目自定义热点和业务数据。

```bash
pano upgrade
pano upgrade --check
```

适用场景：

- CLI 升级后同步新的 `tour.xml` / `main.xml` / `panohper` 模板
- 仅检查当前项目是否落后于内置模板

---

### `pano publish [--oss] [--skip-panos] [--compress-images]`

打包发布文件。

```bash
pano publish               # 本地全量打包
pano publish --skip-panos  # 不打包 panos/，适用于全景瓦片未变化时
pano publish --compress-images  # 压缩发布包中的图片资源
pano publish --oss         # 瓦片路径指向 OSS
```

使用 `--oss` 时需在 `scenes.config.json` 中配置 `ossBaseUrl` 和 `ossBucket`。

说明：

- `pano publish` 仅支持 Include 模式；如果当前 `tour.xml` 已内联场景，请先执行 `pano save`
- `pano publish` 默认会包含 `panos/`，包体最大。
- 如果全景瓦片文件没有变化，只改了热点、标题、分组、UI 或图文资源，可使用 `pano publish --skip-panos` 做增量发布。
- 如果图文热点图片较大，可加上 `--compress-images`，在发布阶段对非全景图片做压缩，不改动源文件。
- `--skip-panos` 时请保留服务器上已有的 `panos/` 目录，不要删除旧瓦片。
- 发布时会自动重新生成 `scenes.xml`、`skin/groups.xml`、`skin/groups_data.xml`
- 发布目录默认来自 `scenes.config.json` 的 `publishDir`，未配置时为 `../publish`
- 生成的压缩包会自动带版本号命名，例如 `publish-v20260425-193000.zip`。

---

### `pano dev <module> <path>`

链接本地模块仓库进行开发（如 panohper UI 库）。

```bash
# 链接本地 panohper 仓库
pano dev panohper ../panohper

# 查看链接状态
pano dev --status

# 恢复为内置版本
pano dev --reset panohper
```

---

## 全局选项

| 选项            | 说明             |
| --------------- | ---------------- |
| `-v, --verbose` | 详细输出         |
| `-q, --quiet`   | 仅显示警告和错误 |
| `-V, --version` | 显示版本号       |

---

## scenes.config.json

```jsonc
{
  "krpanoToolsPath": "", // krpano 安装目录（可省略，使用全局配置）
  "panoSourceDir": "../panoramas", // 全景图源目录（相对 vtour/）
  "startScene": "展馆外观", // 默认起始场景名

  "viewDefaults": {
    "fovmin": 70, // 全局最小视野（可在编辑器「全局视野」中维护）
    "fovmax": 140, // 全局最大视野
  },

  "ossBaseUrl": "https://xxx.com", // OSS 基础 URL（publish --oss 时使用）
  "ossBucket": "oss://bucket/path", // OSS 存储路径

  "groups": [
    // 分组（pano init/sync 自动生成；scenes 字段由排序编辑器写入）
    {
      "name": "展厅A",
      "folders": ["1-展厅A"],
      "scenes": ["panorama1", "panorama2"], // 可选：显式指定组内场景顺序
    },
  ],

  "sceneOverrides": {
    // 场景级覆盖（标题 / 默认视角 / 当前场景视野限制）
    "原始文件名": {
      "title": "自定义标题",
      "ath": 0,
      "atv": 0,
      "fov": 90,
      "fovmin": 70,
      "fovmax": 140,
    },
  },
}
```

> `groups` 由 `pano init` / `pano sync` 自动扫描 `panoramas/` 目录生成，无需手动配置。
> 文件夹名前缀数字会自动去除作为分组名（如 `0-展馆外观` → `展馆外观`）。
> `groups[].scenes` 由**排序编辑器**（`pano serve --edit`）写入，控制该组内场景在 XML 中的顺序。
> `viewDefaults` 由**全局视野**面板维护；`sceneOverrides.fovmin/fovmax` 由**场景设置**面板维护。

---

## 典型工作流

```
1. pano create my-tour          # 创建项目
2. 放入全景图到 panoramas/      # 按子文件夹分组
3. pano init                    # 初始化（生成瓦片 + XML）
4. pano serve --edit            # 预览 + 可视化编辑
  ├── 设为默认视角              # 调整每个场景的初始视角
  ├── 全局视野                  # 设置默认 fovmin / fovmax
  ├── 场景设置                  # 修改场景标题、当前场景视野限制
  ├── 热点管理                  # 添加/编辑跳转、图文、链接、视频、绿幕讲解热点
  ├── 排序管理                  # 调整分组和场景顺序
  ├── 热点模式                  # 编辑 / 预览 切换，检查真实点击行为
  └── 生成 XML                 # 应用所有改动
5. pano publish                 # 打包发布
```

**新增场景**：放入图片 → `pano sync`
**修改标题**：编辑 sceneOverrides → `pano xml`
**新增分组**：在 panoramas/ 下创建文件夹并放入图片 → `pano sync`
**调整顺序**：`pano serve --edit` → 排序管理 → 保存 → 生成 XML

---

## 自动生成文件

以下文件由 CLI 自动维护，不建议手动改：

- `vtour/scenes.xml`
- `vtour/skin/groups.xml`
- `vtour/skin/groups_data.xml`

以下文件通常由项目方维护：

- `vtour/scenes.config.json`
- `vtour/hotspots/*.xml`
- `vtour/hotspots/info/*.json`

**新增视频热点**：`pano serve --edit` → 添加热点 → 选择“播放视频” → 上传视频或填写视频 URL → 生成 XML

---

## 依赖

- **Node.js** >= 18
- **krpano** 1.20+（需自行购买，用于瓦片生成）

## License

MIT

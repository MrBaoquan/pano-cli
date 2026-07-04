<div align="center">

# panohper

**krpano 全景交互组件库**

轻量 · 自包含 · 即插即用

[![krpano](https://img.shields.io/badge/krpano-v1.20.x-blue?style=flat-square)](https://krpano.com)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

</div>

---

panohper（**pano** + **h**ot**p**oint + help**er**）是一组适用于 [krpano](https://krpano.com) v1.20.x 的通用全景交互组件，封装了 **图文弹窗**、**视频播放器**、**滑动提示** 及 **精灵动画** 等展览场景中高频使用的功能。

**自包含设计** — 组件 XML、插件 JS、图标资源全部封装在同一目录内，通过 git submodule 嵌入项目即可使用，开发项目与沉淀组件同步进行。

## ✨ 特性

| | |
|---|---|
| 📸 **图文弹窗** | 支持横向 / 纵向可滚动大图，自动适配屏幕，可叠加子热点 |
| 🎬 **视频播放** | 全屏遮罩播放，移动端兼容（iOS 手动触发），自适应尺寸 |
| 💡 **滑动提示** | 图片超出可视区自动提示 "可上下/左右滑动查看"，3 s 后淡出 |
| 🎞️ **精灵动画** | 通用精灵图帧动画引擎，用于热点图标、加载指示器等 |
| 🔒 **无侵入** | 全部 action 使用 `scope="private:*"` 私有作用域，不污染全局命名空间 |
| 📦 **自包含** | XML + JS 插件 + 图标资源一个目录搞定，submodule 即插即用 |

## 📂 目录结构

```
panohper/                     ← git submodule，克隆到 vtour/panohper/
├── popup.xml                 # 图文弹窗组件
├── videoplayer.xml           # 视频播放器组件
├── tips.xml                  # 滑动提示组件
├── utils.xml                 # 精灵动画 & 工具
├── nav_styles.xml            # 导航 UI 样式覆盖（热点/缩略图/tooltip）
├── assets/                   # 组件内置资源（图标/按钮/加载动画）
│   ├── hotspots/             #   热点图标精灵图
│   │   ├── arrow-forward.png  #   前进箭头（序列帧动画）
│   │   ├── arrow-advance.png  #   前进（720yun 风格）
│   │   ├── arrow-right.png    #   右转
│   │   ├── arrow-left.png     #   左转
│   │   ├── drone.png          #   无人机视角
│   │   ├── ring-large.png     #   光圈（大）
│   │   ├── ring-small.png     #   光圈（小）
│   │   ├── click-bubble.png   #   图文热点图标
│   │   ├── video-play.png     #   视频热点图标
│   │   ├── info-detail.png    #   详情热点图标
│   │   └── glow-white.png     #   白色光晕
│   ├── icons/
│   │   ├── close.png          #   关闭按钮
│   │   └── play.png           #   播放按钮
│   └── loading/
│       └── spinner.png        #   加载动画
├── plugins/                   # 依赖的 krpano 插件
│   ├── pp_blur.js             #   背景高斯模糊
│   ├── scrollarea.js          #   可滚动区域
│   └── videoplayer.js         #   视频播放
├── example/                   # 使用示例
│   ├── tour.xml
│   └── assets/
├── README.md
└── LICENSE
```

## 📦 安装

### 推荐：Git Submodule（开发与沉淀同步）

```bash
cd your-project/vtour
git submodule add https://github.com/MrBaoquan/panohper.git panohper
```

项目结构变为：

```
vtour/
├── tour.xml
├── panohper/          ← git submodule（panohper 仓库）
│   ├── popup.xml
│   ├── assets/
│   ├── plugins/
│   └── ...
├── assets/            ← 项目自己的素材（展板图、视频等）
├── plugins/           ← 项目自己的插件（gyro、webvr 等）
├── skin/
└── panos/
```

**开发工作流：**

```bash
# 在项目中修改 panohper 组件
vim vtour/panohper/popup.xml

# 提交 panohper 改动
cd vtour/panohper
git add -A && git commit -m "fix: ..."
git push

# 回到项目提交 submodule 指针更新
cd ../..
git add vtour/panohper
git commit -m "chore: update panohper"

# 其他项目拉取最新 panohper
cd other-project/vtour/panohper
git pull origin main
```

### 替代：直接复制

将仓库内容复制到 `vtour/panohper/` 即可。

## 🚀 快速开始

在 `tour.xml` 顶部添加：

```xml
<krpano version="1.20.11" title="Virtual Tour">

    <include url="panohper/utils.xml" />
    <include url="panohper/popup.xml"/>
    <include url="panohper/videoplayer.xml"/>
    <include url="panohper/tips.xml"/>

    <include url="skin/vtourskin.xml" />
    <!-- 你的 skin 和场景 ... -->

    <!-- 导航 UI 覆盖（必须在 vtourskin.xml 之后） -->
    <include url="panohper/nav_styles.xml" />
</krpano>
```

> ⚠️ **加载顺序**：
> - `utils.xml` 必须在 `popup.xml` / `videoplayer.xml` **之前**引入
> - `nav_styles.xml` 必须在 `skin/vtourskin.xml` **之后**引入（覆盖默认样式）

然后在 `<scene>` 中添加热点：

```xml
<!-- 图文弹窗热点 -->
<hotspot name="my_board"
    url="panohper/assets/hotspots/click-bubble.png"
    onloaded="do_crop_animation(64,64,60);"
    ath="10" atv="-5"
    onclick="popup('p1', 'assets/hall/exhibit.jpg', 'h');"
/>

<!-- 视频热点 -->
<hotspot name="my_video"
    url="panohper/assets/hotspots/video-play.png"
    onloaded="do_crop_animation(64,64,60);"
    ath="30" atv="-8" scale="0.5"
    onclick="playvideo(get(videourl), get(posterurl)); tween(alpha,0);"
    onvideoclosed="tween(alpha,1);"
    videourl="assets/videos/intro.mp4"
    posterurl=""
/>
```

> **路径约定**：
> - 热点图标 `url` → `panohper/assets/hotspots/XXX.png`（组件内置资源）
> - 弹窗内容图 / 视频 → `assets/XXX`（项目自身素材）

完整示例见 [`example/tour.xml`](example/tour.xml)。

## 📖 API 参考

### `popup.xml` — 图文弹窗

```
popup(pid, image_url, scroll_dir)
popup_close()
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `pid` | string | 弹窗实例 ID，同 ID 复用图层 |
| `image_url` | string | 图片路径（相对于 tour 根目录） |
| `scroll_dir` | `'h'` \| `'v'` | 横向 / 纵向滚动 |

**回调**：`onpopuped`（图片展示后）、`onpopupclosed`（关闭后）

---

### `videoplayer.xml` — 视频播放器

```
playvideo(videourl, posterurl)
closevideo()
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `videourl` | string | 视频路径 |
| `posterurl` | string | 封面图路径（可留空 `""`） |

**回调**：`onvideoclosed`（播放器关闭后）

---

### `tips.xml` — 滑动提示

```
showtip(tip_id)     // 'h' 或 'v'
hidetip()
```

> `popup.xml` 内部会自动调用，通常无需手动使用。

---

### `utils.xml` — 精灵动画

```
do_crop_animation(framewidth, frameheight, framerate)
play_animation(framewidth, frameheight, framerate, loop)
```

---

### `nav_styles.xml` — 导航 UI 样式覆盖

覆盖 vtourskin 默认的热点、缩略图和 tooltip 样式，提供更精致的导航体验。

**覆盖的样式/行为：**

| 覆盖目标 | 效果 |
|----------|------|
| `skin_hotspotstyle` | 热点图标改为前进箭头精灵动画（720yun 风格），悬停时半透明反馈 |
| `skin_hotspotstyle_click` | 去掉默认的飞出 tween，直接切换场景 |
| `skin_hotspotstyle_setup` | 加载时添加 tooltip + 永久场景名标签（读取 `scene[].title`） |
| `skin_thumbtext_style` | 缩略图底部名称：半透明黑底，贴合底边 |
| `skin_tooltip` | 悬停 tooltip：自适应宽度 + 圆角半透明背景 |

**相关 `skin_settings` 控制项：**

```xml
<skin_settings
    thumbs_text="true"         <!-- 缩略图底部固定名称 -->
    tooltips_thumbs="true"     <!-- 缩略图悬停跟随标签 -->
    tooltips_hotspots="false"  <!-- 热点悬停跟随标签（由 addlabel 替代） -->
/>
```

> 此文件必须在 `skin/vtourskin.xml` **之后** include，否则覆盖无效。

## 🧩 进阶用法

### 展板 + 子热点叠加

```xml
<hotspot name="board"
    url="panohper/assets/hotspots/click-bubble.png"
    onloaded="do_crop_animation(64,64,60);"
    ath="-45" atv="-5"
    onclick="popup('p1', 'assets/hall/exhibit.jpg', 'h');"
    onpopuped="set(global.layer[c_spots],parent='scrollarea#p1',visible=true);"
/>

<layer name="c_spots" type="container" width="100%" height="100%"
    visible="false" bgalpha="0.0">
    <layer name="spot_a" type="container" bgalpha="0.0"
        x="calc:(300*100/1000)+'%'" y="calc:(120*100/500)+'%'"
        width="calc:(200*100/1000)+'%'" height="100"
        align="leftop" bgcapture="true"
        onclick="callwith(layer[spot_a_icon],onclick)">
        <layer name="spot_a_icon"
            url="panohper/assets/hotspots/info-detail.png"
            onloaded="do_crop_animation(64,64,60);"
            edge="lefttop" align="right"
            onclick="popup('p2', 'assets/hall/detail.jpg', 'v');"
        />
    </layer>
</layer>
```

### 文字标签热点

```xml
<hotspot name="label"
    type="text" ath="200" atv="-8"
    html="&lt;b&gt;标题&lt;/b&gt;&lt;br/&gt;描述"
    css="color:#FFF; font-size:14px; text-align:center;"
    bg="true" bgcolor="0x2D3E50" bgalpha="0.8" bgroundedge="6"
    padding="8" zoom="false" distorted="false"
    onclick="popup('p1', 'assets/hall/detail.jpg', 'v');"
/>
```

## ⚠️ 注意事项

<details>
<summary><b>1. <code>&lt;action&gt;</code> 内禁止 XML 注释</b></summary>

krpano 将 `<action>` 内容当作脚本处理，写 `<!-- -->` 会导致解析失败。
</details>

<details>
<summary><b>2. 条件用 <code>EQ</code> / <code>GT</code> / <code>LT</code></b></summary>

```
✅ if(get(x) EQ null, ...);
❌ if(get(x) == null, ...);
```
</details>

<details>
<summary><b>3. 私有作用域中用 <code>global.layer[name]</code></b></summary>

```
✅ tween(global.layer[h_tip].alpha, 1.0);
❌ tween(layer[h_tip].alpha, 1.0);
```
</details>

<details>
<summary><b>4. 隐藏 text layer 用 <code>alpha</code> 不用 <code>scale</code></b></summary>

```
✅ set(global.layer[tip].alpha, 0);
❌ set(global.layer[tip].scale, 0);
```
</details>

<details>
<summary><b>5. HTML 实体用 XML 数字引用</b></summary>

```
✅ &#215;   &#160;
❌ &times;  &nbsp;
```
</details>

<details>
<summary><b>6. <code>pp_blur</code> 插件已由 popup.xml 声明，不要重复声明</b></summary>

`videoplayer.xml` 共享同一实例，无需额外 `<plugin>`。
</details>

## 🤝 贡献

欢迎 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送分支 (`git push origin feature/amazing`)
5. 创建 Pull Request

## 📄 License

[MIT](LICENSE) © panohper contributors
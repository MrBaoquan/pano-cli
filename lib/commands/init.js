// @ts-check
import { existsSync, writeFileSync, copyFileSync, cpSync, mkdirSync, unlinkSync, readdirSync, readFileSync } from 'fs';
import { join, parse as parsePath } from 'path';
import { execSync } from 'child_process';
import { loadConfig, validateConfig, vtourDir, hotspotsDir, BuildError } from '../core/config.js';
import { scanSourceImages, syncConfigGroups } from '../core/scanner.js';
import { generateTiles } from '../core/tiles.js';
import { generateScenesXml, generateGroupsXml, printSceneMapping } from '../core/xml-gen.js';
import { log } from '../core/logger.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

/**
 * 在 tour.html 中注入 pano-runtime.js 引用。
 * krpanotools makepano 生成的 tour.html 只包含 tour.js，
 * 需要在 tour.js 后添加 pano-runtime.js 才能支持热点 overlay 功能。
 * @param {string} htmlPath tour.html 的完整路径
 */
function injectRuntimeScript(htmlPath) {
  if (!existsSync(htmlPath)) return;
  let html = readFileSync(htmlPath, 'utf-8');
  if (html.includes('pano-runtime.js')) return; // 已注入
  html = html.replace(/<script src="tour\.js"><\/script>/, '<script src="tour.js"></script>\n<script src="pano-runtime.js"></script>');
  writeFileSync(htmlPath, html, 'utf-8');
}

/**
 * 初始化工程：读取 scenes.config.json，调用 krpanotools 生成完整 vtour，然后生成全部瓦片和 XML。
 * @param {{ repair?: boolean }} [opts]
 */
export async function cmdInit(opts = {}) {
  const vdir = vtourDir();

  // --repair: 修复缺失的框架文件
  if (opts.repair) {
    return cmdRepair(vdir);
  }

  // 如果已有 tour.html 说明已经初始化过
  if (existsSync(join(vdir, 'tour.html'))) {
    log.warn('vtour 已包含 tour.html，跳过初始化。');
    log.info('如需重新初始化，请先删除 tour.html、tour.js、skin/、plugins/ 等文件。');
    return;
  }

  // ── 读取并校验配置 ──
  let config = loadConfig();
  validateConfig(config, { requireTools: true });

  // ── 自动同步 groups（扫描 panoSourceDir 文件夹结构）──
  config = syncConfigGroups(config);

  const krpanoPath = config.krpanoToolsPath;
  const krpanoExe = join(krpanoPath, 'krpanotools.exe');
  const vtourConfig = join(krpanoPath, 'templates', 'vtour-multires.config');
  if (!existsSync(vtourConfig)) {
    throw new BuildError(`vtour-multires.config 未找到: ${vtourConfig}`);
  }

  // ── 扫描全景图源目录 ──
  const scenes = scanSourceImages(config);
  if (scenes.length === 0) {
    throw new BuildError('未找到全景图。请先将全景图放入 panoSourceDir 对应的分组文件夹中。');
  }

  log.title('krpano Build: 初始化工程');
  log.info(`krpano: ${krpanoPath}`);
  log.info(`全景图: ${scenes.length} 张\n`);

  // ── Step 1: 用第一张全景图生成完整 vtour 结构 ──
  log.step(1, 4, '调用 krpanotools 生成 vtour 基础文件...');

  const firstImage = scenes[0].source;
  log.info(`  使用: ${parsePath(firstImage).base}`);

  const initConfig = join(krpanoPath, 'templates', '.pano_cli_init.config');
  const customConfig = `# pano-cli init config
include vtour-multires.config
outputpath=${vdir.replace(/\\/g, '/')}
`;
  writeFileSync(initConfig, customConfig, 'utf-8');

  const cmd = `"${krpanoExe}" makepano -config="${initConfig}" "${firstImage}"`;
  log.debug(`执行: ${cmd}`);
  try {
    execSync(cmd, { encoding: 'utf-8', input: 'y\n', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    throw new BuildError(`krpanotools 执行失败: ${err.stderr || err.stdout || err.message}`);
  } finally {
    if (existsSync(initConfig)) unlinkSync(initConfig);
  }
  log.info('  + tour.html, tour.js, skin/, plugins/');
  log.info('  + tour_testingserver.exe');

  // ── Step 2: 覆盖 tour.xml + 复制 panohper ──
  log.step(2, 4, '配置 tour.xml 模板 + panohper...');
  copyFileSync(join(TEMPLATES_DIR, 'tour.xml'), join(vdir, 'tour.xml'));
  log.info('  + tour.xml（含 scenes.xml include、panohper、skin 引用）');

  // 复制 panohper 库（递归复制整个目录，包括子目录如 assets/、plugins/）
  const panohperSrc = join(TEMPLATES_DIR, 'panohper');
  const panohperDest = join(vdir, 'panohper');
  if (!existsSync(panohperDest)) {
    cpSync(panohperSrc, panohperDest, { recursive: true });
    log.info('  + panohper/（内置 UI 库）');
  } else {
    log.info('  panohper/ 已存在，跳过');
  }

  // 创建 main.xml（用户自定义逻辑，仅首次创建）
  const mainDest = join(vdir, 'main.xml');
  if (!existsSync(mainDest)) {
    copyFileSync(join(TEMPLATES_DIR, 'main.xml'), mainDest);
    log.info('  + main.xml（用户自定义逻辑）');
  }

  // 复制 pano-runtime.js（热点运行时：信息面板/视频/链接/绿幕讲解 overlay）
  const runtimeDest = join(vdir, 'pano-runtime.js');
  if (!existsSync(runtimeDest)) {
    copyFileSync(join(TEMPLATES_DIR, 'pano-runtime.js'), runtimeDest);
    log.info('  + pano-runtime.js（热点运行时）');
  }

  // 在 tour.html 中注入 pano-runtime.js 引用（krpanotools 生成的 tour.html 不含此引用）
  injectRuntimeScript(join(vdir, 'tour.html'));

  mkdirSync(hotspotsDir(), { recursive: true });

  // ── Step 3: 生成全部瓦片 ──
  log.step(3, 4, `生成瓦片（${scenes.length} 张全景图）...`);
  const cache = generateTiles(config, scenes, true);

  // ── Step 4: 生成 XML ──
  log.step(4, 4, '生成 XML...');
  generateScenesXml(scenes, cache, config);
  generateGroupsXml(config);

  printSceneMapping(scenes);
  log.title('初始化完成');
  log.info('后续命令:');
  log.info('  pano serve      # 本地预览');
  log.info('  pano editor     # 编辑热点');
  log.info('  pano sync       # 新增全景图后同步\n');
}

/**
 * 修复缺失的框架文件（不重新生成瓦片）
 * @param {string} vdir
 */
async function cmdRepair(vdir) {
  log.title('修复框架文件');

  let fixed = 0;

  // tour.xml
  const tourDest = join(vdir, 'tour.xml');
  if (!existsSync(tourDest)) {
    copyFileSync(join(TEMPLATES_DIR, 'tour.xml'), tourDest);
    log.info('  + tour.xml');
    fixed++;
  }

  // main.xml
  const mainDest = join(vdir, 'main.xml');
  if (!existsSync(mainDest)) {
    copyFileSync(join(TEMPLATES_DIR, 'main.xml'), mainDest);
    log.info('  + main.xml');
    fixed++;
  }

  // panohper/
  const panohperDest = join(vdir, 'panohper');
  if (!existsSync(panohperDest)) {
    const panohperSrc = join(TEMPLATES_DIR, 'panohper');
    mkdirSync(panohperDest, { recursive: true });
    for (const f of readdirSync(panohperSrc)) {
      if (f === 'plugins') continue;
      copyFileSync(join(panohperSrc, f), join(panohperDest, f));
    }
    const pluginsSrc = join(panohperSrc, 'plugins');
    const pluginsDest = join(panohperDest, 'plugins');
    mkdirSync(pluginsDest, { recursive: true });
    for (const f of readdirSync(pluginsSrc)) {
      copyFileSync(join(pluginsSrc, f), join(pluginsDest, f));
    }
    log.info('  + panohper/');
    fixed++;
  }

  // hotspots/
  const hdir = hotspotsDir();
  if (!existsSync(hdir)) {
    mkdirSync(hdir, { recursive: true });
    log.info('  + hotspots/');
    fixed++;
  }

  // skin/ 目录
  const skinDir = join(vdir, 'skin');
  if (!existsSync(skinDir)) {
    mkdirSync(skinDir, { recursive: true });
    log.info('  + skin/');
    fixed++;
  }

  // groups_data.xml（如果有 config 就重新生成）
  const configFile = join(vdir, 'scenes.config.json');
  if (existsSync(configFile)) {
    const { loadConfig } = await import('../core/config.js');
    const { generateGroupsXml } = await import('../core/xml-gen.js');
    const config = loadConfig();
    generateGroupsXml(config);
    fixed++;
  }

  // WORKFLOW.md
  const wfDest = join(vdir, 'WORKFLOW.md');
  if (!existsSync(wfDest)) {
    copyFileSync(join(TEMPLATES_DIR, 'WORKFLOW.md'), wfDest);
    log.info('  + WORKFLOW.md');
    fixed++;
  }

  if (fixed === 0) {
    log.info('所有框架文件完整，无需修复。');
  } else {
    log.title('修复完成');
  }
}

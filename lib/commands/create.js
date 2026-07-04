// @ts-check
import { existsSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { createInterface } from 'readline';
import { log } from '../core/logger.js';
import { BuildError, loadGlobalConfig } from '../core/config.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

/**
 * 交互式输入提示。
 * @param {string} question
 * @returns {Promise<string>}
 */
function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * 创建新全景项目骨架。
 * @param {string} projectName
 */
export async function cmdCreate(projectName) {
  const target = resolve(process.cwd(), projectName);
  if (existsSync(target)) {
    throw new BuildError(`目录已存在: ${target}`);
  }

  // 交互式输入 krpanoToolsPath（全局配置作为默认值）
  let krpanoToolsPath = '';
  const globalCfg = loadGlobalConfig();
  const defaultKrpano = globalCfg.krpanoToolsPath || '';
  const hint = defaultKrpano ? `（回车使用全局配置: ${defaultKrpano}）` : '（回车跳过，后续用 pano config --krpano 配置）';
  const inputPath = await prompt(`\nkrpanotools 所在目录${hint}: `);
  if (inputPath) {
    const resolved = resolve(inputPath);
    const exeName = process.platform === 'win32' ? 'krpanotools.exe' : 'krpanotools';
    if (existsSync(join(resolved, exeName))) {
      krpanoToolsPath = resolved.replace(/\\/g, '/');
      log.info(`✓ 已找到 krpanotools: ${krpanoToolsPath}`);
    } else {
      log.warn(`未在该目录找到 ${exeName}，已跳过。后续可用 pano config --krpano 配置。`);
    }
  } else if (defaultKrpano) {
    krpanoToolsPath = defaultKrpano;
    log.info(`✓ 使用全局配置: ${krpanoToolsPath}`);
  }

  log.title('krpano Build: 创建项目');
  log.info(`项目: ${projectName}`);
  log.info(`位置: ${target}\n`);

  const vtourDir = join(target, 'vtour');
  mkdirSync(vtourDir, { recursive: true });

  // scenes.config.json（填入 krpanoToolsPath）
  const configTemplate = JSON.parse(readFileSync(join(TEMPLATES_DIR, 'scenes.config.json'), 'utf-8'));
  configTemplate.krpanoToolsPath = krpanoToolsPath;
  writeFileSync(join(vtourDir, 'scenes.config.json'), JSON.stringify(configTemplate, null, 4), 'utf-8');
  log.info('  + vtour/scenes.config.json');
  if (krpanoToolsPath) {
    log.info(`    krpanoToolsPath = ${krpanoToolsPath}`);
  }

  // tour.xml 模板
  copyFileSync(join(TEMPLATES_DIR, 'tour.xml'), join(vtourDir, 'tour.xml'));
  log.info('  + vtour/tour.xml');

  // main.xml（用户自定义逻辑）
  copyFileSync(join(TEMPLATES_DIR, 'main.xml'), join(vtourDir, 'main.xml'));
  log.info('  + vtour/main.xml');

  // WORKFLOW.md
  copyFileSync(join(TEMPLATES_DIR, 'WORKFLOW.md'), join(vtourDir, 'WORKFLOW.md'));
  log.info('  + vtour/WORKFLOW.md');

  // 子目录
  for (const d of ['hotspots']) {
    mkdirSync(join(vtourDir, d), { recursive: true });
    log.info(`  + vtour/${d}/`);
  }

  // 全景图源目录
  const panoSrc = join(target, 'panoramas', 'default');
  mkdirSync(panoSrc, { recursive: true });
  log.info('  + panoramas/default/');

  // .gitignore
  copyFileSync(join(TEMPLATES_DIR, '.gitignore.tpl'), join(target, '.gitignore'));
  log.info('  + .gitignore');

  // README
  const readme = `# ${projectName}\n\n全景漫游项目。\n\n## 快速开始\n\n\`\`\`bash\ncd ${projectName}/vtour\n# 1. 编辑 scenes.config.json（填写 krpanoToolsPath、配置分组）\n# 2. 将全景图放入 panoramas/ 对应分组文件夹\npano init       # 生成完整工程\npano serve      # 本地预览\n\`\`\`\n\n详见 \`vtour/WORKFLOW.md\`。\n`;
  writeFileSync(join(target, 'README.md'), readme, 'utf-8');
  log.info('  + README.md');

  log.title('项目创建完成');
  log.info('下一步:');
  log.info(`  1. cd ${projectName}/vtour`);
  if (!krpanoToolsPath) {
    log.info('  2. pano config --krpano <krpano目录>');
    log.info('  3. 将全景图放入 panoramas/ 对应分组文件夹');
    log.info('  4. pano init\n');
  } else {
    log.info('  2. 将全景图放入 panoramas/ 对应分组文件夹');
    log.info('  3. pano init\n');
  }
}

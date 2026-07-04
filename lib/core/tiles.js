// @ts-check
import { existsSync, readdirSync, statSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { vtourDir, panosDir, tilesConfigPath, loadMultiresCache, saveMultiresCache } from './config.js';
import { log } from './logger.js';

/**
 * 根据 scenes.config.json 动态生成 krpano 切片配置文件。
 * @param {object} config
 * @returns {string} 配置文件路径
 */
export function writeTilesConfig(config) {
  const krpanoTemplates = join(config.krpanoToolsPath, 'templates');
  const basicsettingsPath = join(krpanoTemplates, 'basicsettings.config').replace(/\\/g, '/');
  const vtour = vtourDir().replace(/\\/g, '/');

  const content = `# Auto-generated — DO NOT EDIT
include ${basicsettingsPath}
panotype=autodetect,flat
hfov=360

flash=false
html5=true

converttocube=true
converttocubelimit=360x120
converttocubemaxwidth=60000

multires=true
tilesize=512
levels=auto
levelstep=2
maxsize=auto
maxcubesize=auto

outputpath=${vtour}
tilepath=%OUTPUTPATH%/panos/%BASENAME%.tiles/[c/]l%Al/%V/l%Al[_c]_%V_%H.jpg

preview=true
graypreview=false
previewsmooth=25
previewpath=%OUTPUTPATH%/panos/%BASENAME%.tiles/preview.jpg

makethumb=true
thumbsize=240
thumbpath=%OUTPUTPATH%/panos/%BASENAME%.tiles/thumb.jpg

xml=false
html=false
`;

  const p = tilesConfigPath();
  writeFileSync(p, content, 'utf-8');
  return p;
}

/**
 * 从已有瓦片目录结构检测 multires 值。
 * @param {string} tilesPath
 * @returns {string|null}
 */
export function detectMultiresFromTiles(tilesPath) {
  if (!existsSync(tilesPath)) return null;

  // 查找任意一个面的目录
  let faceDir = null;
  for (const face of ['f', 'b', 'l', 'r', 'u', 'd']) {
    const candidate = join(tilesPath, face);
    if (existsSync(candidate)) {
      faceDir = candidate;
      break;
    }
  }
  if (!faceDir) return null;

  const levels = readdirSync(faceDir)
    .filter(d => /^l\d+$/.test(d) && statSync(join(faceDir, d)).isDirectory())
    .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));

  if (!levels.length) return null;

  const sizes = levels.map(levelName => {
    const levelDir = join(faceDir, levelName);
    const rows = readdirSync(levelDir).filter(d => statSync(join(levelDir, d)).isDirectory());
    return rows.length * 512;
  });

  sizes.sort((a, b) => a - b);
  return ['512', ...sizes.map(String)].join(',');
}

/**
 * 从 krpanotools 标准输出解析每个场景的 multires 值。
 * @param {string} stdoutText
 * @returns {Record<string, string>}
 */
export function parseMultiresFromStdout(stdoutText) {
  const result = {};
  let currentBasename = null;

  for (const line of stdoutText.split('\n')) {
    // 匹配 "processing - xxx.jpg" 或 "processing - xxx.jpeg"
    let m = line.match(/processing\s+-\s+(.+)\.jpe?g/i);
    if (m) {
      currentBasename = m[1];
      continue;
    }
    // 匹配 multires 输出行：- output: multires, levels=4 - 5120x5120 2560x2560 1280x1280 640x640
    m = line.match(/^\s*-\s*output:\s*multires,\s*levels=\d+\s*-\s*(.+)/);
    if (m && currentBasename) {
      const sizesStr = m[1].trim();
      const sizes = [];
      for (const part of sizesStr.split(/\s+/)) {
        const wh = part.split('x');
        if (wh.length === 2 && /^\d+$/.test(wh[0])) {
          sizes.push(parseInt(wh[0]));
        }
      }
      if (sizes.length) {
        sizes.sort((a, b) => a - b);
        // 直接使用 krpano 输出的实际缩放尺寸
        result[currentBasename] = ['512', ...sizes.map(String)].join(',');
      }
    }
  }
  return result;
}

/**
 * 运行 krpanotools 为新增/变更的全景图生成切片瓦片。
 * @param {object} config
 * @param {Array<{filename:string, encoded:string, source:string, tilesFolder:string}>} scenes
 * @param {boolean} [force=false]
 * @param {string[]} [forceScenes=[]]
 * @returns {Record<string, string>} multiresCache
 */
export function generateTiles(config, scenes, force = false, forceScenes = []) {
  const exeName = process.platform === 'win32' ? 'krpanotools.exe' : 'krpanotools';
  const krpanoExe = join(config.krpanoToolsPath, exeName);
  if (!existsSync(krpanoExe)) {
    throw new Error(`krpanotools 未找到: ${krpanoExe}`);
  }

  const panos = panosDir();
  mkdirSync(panos, { recursive: true });
  const tilesConfig = writeTilesConfig(config);
  const cache = loadMultiresCache();
  const forcedSceneSet = new Set(forceScenes);

  // 判断哪些图片需要处理
  const toProcess = [];
  for (const scene of scenes) {
    const tilesPath = join(panos, scene.tilesFolder);
    const thumbPath = join(tilesPath, 'thumb.jpg');

    let needs = false;
    if (force) {
      needs = true;
    } else if (forcedSceneSet.has(scene.filename)) {
      needs = true;
    } else if (!existsSync(tilesPath) || !existsSync(thumbPath)) {
      needs = true;
    } else if (!(scene.filename in cache)) {
      needs = true;
    } else {
      const sourceMtime = statSync(scene.source).mtimeMs;
      const thumbMtime = statSync(thumbPath).mtimeMs;
      if (sourceMtime > thumbMtime) needs = true;
    }

    if (needs) {
      toProcess.push(scene);
    } else {
      log.debug(`跳过: ${scene.filename}`);
    }
  }

  if (!toProcess.length) {
    log.info('所有瓦片已是最新。');
    return cache;
  }

  log.info(`需要处理 ${toProcess.length} 张全景图...`);

  for (let idx = 0; idx < toProcess.length; idx++) {
    const scene = toProcess[idx];
    const fn = scene.filename;
    log.info(`[${idx + 1}/${toProcess.length}] ${fn}`);

    try {
      // krpanotools 进度信息输出到 stderr，用 2>&1 合并到 stdout 以便解析 multires
      const output = execSync(`"${krpanoExe}" makepano -config="${tilesConfig}" "${scene.source}" 2>&1`, { encoding: 'utf-8', input: 'y\n' });

      // 从输出解析 multires（进度信息通常在 stderr 中）
      const parsed = parseMultiresFromStdout(output);
      const encoded = scene.encoded;
      if (parsed[encoded]) {
        cache[fn] = parsed[encoded];
        log.debug(`multires=${cache[fn]}`);
      } else if (parsed[fn]) {
        cache[fn] = parsed[fn];
        log.debug(`multires=${cache[fn]}`);
      } else {
        // 尝试从输出中提取
        const keys = Object.keys(parsed);
        if (keys.length) {
          cache[fn] = parsed[keys[0]];
          log.debug(`multires=${cache[fn]} (from ${keys[0]})`);
        } else {
          cache[fn] = '512,1024,2048,4096';
          log.warn(`使用默认 multires: ${fn}`);
        }
      }
    } catch (err) {
      log.error(`处理失败: ${fn} — ${err.message}`);
    }
  }

  saveMultiresCache(cache);

  // 清理临时文件
  try { unlinkSync(tilesConfigPath()); } catch { /* ignore */ }

  return cache;
}

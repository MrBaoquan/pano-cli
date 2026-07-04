// @ts-check
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import {
  tourXmlPath, hotspotsDir, loadConfig, loadMultiresCache,
  saveMultiresCache, panosDir, vtourDir, BuildError
} from '../core/config.js';
import { krpanoEncode } from '../core/encoder.js';
import { scanSourceImages } from '../core/scanner.js';
import { detectMultiresFromTiles } from '../core/tiles.js';
import { generateScenesXml } from '../core/xml-gen.js';
import { log } from '../core/logger.js';

/**
 * 构建 scene_id -> filename 的映射表。
 * @param {object} config
 * @returns {Record<string, string>}
 */
function buildSceneIdToFilenameMap(config) {
  const sourceDir = resolve(vtourDir(), config.panoSourceDir);
  const mapping = {};
  for (const group of config.groups) {
    for (const folderName of group.folders) {
      const folderPath = join(sourceDir, folderName);
      if (!existsSync(folderPath)) continue;
      const files = readdirSync(folderPath).filter(f => f.toLowerCase().endsWith('.jpg'));
      for (const f of files) {
        const fn = f.replace(/\.jpg$/i, '');
        const encoded = krpanoEncode(fn);
        mapping[`scene_${encoded}`] = fn;
      }
    }
  }
  return mapping;
}

const STANDARD_TAGS = new Set([
  'control', 'view', 'preview', 'image', 'cube', 'sphere',
  'cylinder', 'flat', 'left', 'right', 'front', 'back', 'up', 'down'
]);

/**
 * 从 tour.xml 提取热点到 hotspots/ 目录，然后恢复 include 结构。
 */
export async function cmdSave() {
  log.title('krpano Build: 保存编辑结果');

  const tourPath = tourXmlPath();
  let tourContent = readFileSync(tourPath, 'utf-8');

  if (tourContent.includes('<include url="scenes.xml"')) {
    log.info('tour.xml 已是 include 模式，无需保存。');
    return;
  }

  if (!/<scene\s/.test(tourContent)) {
    throw new BuildError('tour.xml 中未找到内联场景');
  }

  const config = loadConfig();
  const idToFn = buildSceneIdToFilenameMap(config);

  const hotspotsPath = hotspotsDir();
  mkdirSync(hotspotsPath, { recursive: true });

  let extractedCount = 0;
  const scenePattern = /([ \t]*)<scene\s+name="([^"]+)"[^>]*>(.*?)<\/scene>/gs;

  let match;
  while ((match = scenePattern.exec(tourContent)) !== null) {
    const sceneName = match[2];
    const sceneBody = match[3];

    const fn = idToFn[sceneName];
    if (!fn) {
      log.warn(`未识别的场景: ${sceneName}，跳过热点提取`);
      continue;
    }

    // 提取热点内容（非标准标签的行）
    const hotspotLines = [];
    let inComment = false;
    for (const line of sceneBody.split('\n')) {
      const stripped = line.trim();
      if (!stripped) continue;

      // 跳过 XML 注释
      if (stripped.includes('<!--') && stripped.includes('-->')) continue;
      if (stripped.includes('<!--')) { inComment = true; continue; }
      if (stripped.includes('-->')) { inComment = false; continue; }
      if (inComment) continue;

      const tagMatch = stripped.match(/^<\/?([a-zA-Z_][a-zA-Z0-9_]*)[\s\t/>]/);
      if (tagMatch) {
        const tagName = tagMatch[1].toLowerCase();
        if (STANDARD_TAGS.has(tagName)) continue;
      }

      hotspotLines.push(stripped);
    }

    if (hotspotLines.length) {
      const hotspotContent = hotspotLines.join('\n');
      const hotspotFile = join(hotspotsPath, `${fn}.xml`);
      writeFileSync(hotspotFile, hotspotContent, 'utf-8');
      extractedCount++;
      log.info(`保存: ${fn} -> hotspots/${fn}.xml (${hotspotLines.length} lines)`);
    }
  }

  log.info(`共提取 ${extractedCount} 个场景的热点`);

  // 恢复 include 结构
  const firstScene = tourContent.match(/\n([ \t]*(?:<!--.*?-->\s*)?<scene\s)/);
  const lastSceneEnd = tourContent.lastIndexOf('</scene>');

  if (firstScene && lastSceneEnd >= 0) {
    const endOfLine = tourContent.indexOf('\n', lastSceneEnd);
    const sliceEnd = endOfLine >= 0 ? endOfLine + 1 : tourContent.length;
    const header = tourContent.slice(0, firstScene.index);
    const footer = tourContent.slice(sliceEnd).replace(/^\n+/, '');
    const newContent = header + '\n\n\t<include url="scenes.xml" />\n\n' + footer;
    writeFileSync(tourPath, newContent, 'utf-8');
    log.info('tour.xml 已恢复为 include 模式');
  } else {
    throw new BuildError('无法定位场景边界，tour.xml 未修改');
  }

  // 重新生成 scenes.xml（包含刚提取的热点）
  log.info('重新生成 scenes.xml ...');
  const scenes = scanSourceImages(config);
  const cache = loadMultiresCache();
  const panos = panosDir();
  for (const scene of scenes) {
    if (!(scene.filename in cache)) {
      const detected = detectMultiresFromTiles(join(panos, scene.tilesFolder));
      cache[scene.filename] = detected || '512,1024,2048,4096';
    }
  }
  saveMultiresCache(cache);
  generateScenesXml(scenes, cache, config);

  log.title('保存完成');
}

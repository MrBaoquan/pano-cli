// @ts-check
import { loadConfig, validateConfig } from '../core/config.js';
import { scanSourceImages, syncConfigGroups } from '../core/scanner.js';
import { generateTiles } from '../core/tiles.js';
import { generateScenesXml, generateGroupsXml, printSceneMapping } from '../core/xml-gen.js';
import { log } from '../core/logger.js';

/**
 * 同步：生成瓦片 + 更新 XML。
 * @param {{ force?: boolean, forceScene?: string|string[] }} opts
 */
export async function cmdSync(opts = {}) {
  log.title('krpano Build: 同步');

  let config = loadConfig();
  validateConfig(config, { requireTools: true });

  config = syncConfigGroups(config);

  log.step(1, 4, '扫描源文件...');
  const scenes = scanSourceImages(config);
  log.info(`找到 ${scenes.length} 张全景图\n`);

  const forcedScenes = Array.isArray(opts.forceScene)
    ? opts.forceScene.filter(Boolean)
    : (opts.forceScene ? [opts.forceScene] : []);
  if (forcedScenes.length) {
    const sceneNames = new Set(scenes.map(scene => scene.filename));
    const missing = forcedScenes.filter(name => !sceneNames.has(name));
    if (missing.length) {
      throw new Error(`未找到指定场景: ${missing.join(', ')}`);
    }
    log.info(`强制重建指定场景: ${forcedScenes.join(', ')}\n`);
  }

  log.step(2, 4, '生成切片瓦片...');
  const cache = generateTiles(config, scenes, opts.force, forcedScenes);

  log.step(3, 4, '生成 scenes.xml ...');
  generateScenesXml(scenes, cache, config);

  log.step(4, 4, '更新 groups.xml ...');
  generateGroupsXml(config);

  printSceneMapping(scenes);
  log.title('同步完成');
}

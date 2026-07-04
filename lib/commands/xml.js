// @ts-check
import { loadConfig, validateConfig, loadMultiresCache, saveMultiresCache, panosDir } from '../core/config.js';
import { scanSourceImages, syncConfigGroups } from '../core/scanner.js';
import { detectMultiresFromTiles } from '../core/tiles.js';
import { generateScenesXml, generateGroupsXml, printSceneMapping } from '../core/xml-gen.js';
import { log } from '../core/logger.js';
import { join } from 'path';

/**
 * 仅更新 XML（不生成瓦片）。
 */
export async function cmdXml() {
  log.title('krpano Build: 仅更新 XML');

  let config = loadConfig();
  validateConfig(config);

  config = syncConfigGroups(config);

  log.step(1, 3, '扫描源文件...');
  const scenes = scanSourceImages(config);
  log.info(`找到 ${scenes.length} 张全景图\n`);

  const cache = loadMultiresCache();
  let updated = false;
  const panos = panosDir();

  for (const scene of scenes) {
    if (!(scene.filename in cache)) {
      const detected = detectMultiresFromTiles(join(panos, scene.tilesFolder));
      if (detected) {
        cache[scene.filename] = detected;
        updated = true;
      } else {
        cache[scene.filename] = '512,1024,2048,4096';
        updated = true;
        log.warn(`${scene.filename} 无 multires 数据，使用默认值`);
      }
    }
  }
  if (updated) saveMultiresCache(cache);

  log.step(2, 3, '生成 scenes.xml ...');
  generateScenesXml(scenes, cache, config);

  log.step(3, 3, '生成 groups_data.xml ...');
  generateGroupsXml(config);

  printSceneMapping(scenes);
  log.title('更新完成');
}

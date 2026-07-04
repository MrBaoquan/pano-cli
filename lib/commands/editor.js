// @ts-check
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { tourXmlPath, scenesXmlPath, BuildError } from '../core/config.js';
import { log } from '../core/logger.js';

/**
 * 将 scenes.xml 内联到 tour.xml，供 VTour Editor 编辑热点。
 */
export async function cmdEditor() {
  log.title('krpano Build: 进入编辑模式');

  const tourPath = tourXmlPath();
  let tourContent = readFileSync(tourPath, 'utf-8');

  if (!tourContent.includes('<include url="scenes.xml"')) {
    log.info('tour.xml 中未找到 scenes.xml 引用。');
    if (/<scene\s/.test(tourContent)) {
      log.info('场景已内联，当前已处于编辑模式。');
    } else {
      throw new BuildError('tour.xml 中既无 include 也无 scene，请先运行 pano xml');
    }
    return;
  }

  const scenesPath = scenesXmlPath();
  if (!existsSync(scenesPath)) {
    throw new BuildError('scenes.xml 不存在，请先运行 pano xml');
  }

  // 读取 scenes.xml 中的场景内容（去掉外层 <krpano> 标签）
  const scenesContent = readFileSync(scenesPath, 'utf-8');
  const m = scenesContent.match(/<krpano[^>]*>\s*\n?(.*?)\n?\s*<\/krpano>/s);
  if (!m) {
    throw new BuildError('无法解析 scenes.xml');
  }
  const scenesBody = m[1];

  // 替换 include 为内联场景
  tourContent = tourContent.replace(
    /\s*<include url="scenes\.xml"\s*\/?>\s*/,
    '\n\n' + scenesBody + '\n\n'
  );

  writeFileSync(tourPath, tourContent, 'utf-8');
  log.info('已将场景内联到 tour.xml');
  log.info('现在可以使用 VTour Editor 编辑热点。');
  log.info('完成后运行: pano save\n');
}

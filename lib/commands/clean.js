// @ts-check
import { existsSync, rmSync, mkdirSync, unlinkSync } from 'fs';
import { panosDir, multiresCachePath, scenesXmlPath, tilesConfigPath, tempXmlPath } from '../core/config.js';
import { log } from '../core/logger.js';
import { readdirSync } from 'fs';

/**
 * 清除旧瓦片数据。
 */
export async function cmdClean() {
  log.title('krpano Build: 清理');

  const panos = panosDir();
  if (existsSync(panos)) {
    const items = readdirSync(panos);
    log.info(`清除 panos/ 下 ${items.length} 个项目...`);
    rmSync(panos, { recursive: true, force: true });
    mkdirSync(panos, { recursive: true });
    log.info('已清除。');
  }

  for (const f of [multiresCachePath(), scenesXmlPath(), tilesConfigPath(), tempXmlPath()]) {
    if (existsSync(f)) {
      unlinkSync(f);
      log.info(`已删除: ${f.split(/[\\/]/).pop()}`);
    }
  }

  log.title('清理完成。运行 pano sync 重新构建。');
}

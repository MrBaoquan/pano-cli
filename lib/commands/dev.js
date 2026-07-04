// @ts-check
import { existsSync, lstatSync, symlinkSync, unlinkSync, rmSync, cpSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { vtourDir, BuildError } from '../core/config.js';
import { log } from '../core/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

/**
 * 支持的可链接模块
 */
const MODULES = {
  panohper: {
    description: 'panohper UI 库',
    destName: 'panohper',
  },
};

/**
 * pano dev <module> <path> — 将本地仓库 symlink 到 vtour 中进行开发
 * pano dev --reset <module> — 恢复为内置版本
 * pano dev --status — 查看当前链接状态
 * @param {string} [moduleName]
 * @param {string} [localPath]
 * @param {{ reset?: boolean, status?: boolean }} opts
 */
export async function cmdDev(moduleName, localPath, opts = {}) {
  const vdir = vtourDir();

  // --status: 查看所有模块状态
  if (opts.status) {
    log.title('开发模块状态');
    for (const [name, mod] of Object.entries(MODULES)) {
      const dest = join(vdir, mod.destName);
      if (!existsSync(dest)) {
        log.info(`  ${name}: 未安装`);
      } else if (lstatSync(dest).isSymbolicLink()) {
        log.info(`  ${name}: → ${resolve(vdir, dest)} (symlink)`);
      } else {
        log.info(`  ${name}: 内置版本`);
      }
    }
    return;
  }

  if (!moduleName) {
    throw new BuildError('请指定模块名。可用模块: ' + Object.keys(MODULES).join(', '));
  }

  const mod = MODULES[moduleName];
  if (!mod) {
    throw new BuildError(`未知模块: ${moduleName}\n可用模块: ${Object.keys(MODULES).join(', ')}`);
  }

  const dest = join(vdir, mod.destName);

  // --reset: 恢复内置版本
  if (opts.reset) {
    if (existsSync(dest)) {
      if (lstatSync(dest).isSymbolicLink()) {
        unlinkSync(dest);
        log.info(`已移除 symlink: ${mod.destName}`);
      } else {
        rmSync(dest, { recursive: true, force: true });
        log.info(`已移除目录: ${mod.destName}`);
      }
    }
    // 从模板恢复
    const templateSrc = join(TEMPLATES_DIR, mod.destName);
    if (existsSync(templateSrc)) {
      cpSync(templateSrc, dest, { recursive: true });
      log.info(`已恢复内置版本: ${mod.destName}/`);
    } else {
      log.warn(`内置模板不存在: ${mod.destName}`);
    }
    return;
  }

  // link: 创建 symlink
  if (!localPath) {
    throw new BuildError(`用法: pano dev ${moduleName} <本地仓库路径>\n示例: pano dev panohper ../panohper`);
  }

  const srcPath = resolve(localPath);
  if (!existsSync(srcPath)) {
    throw new BuildError(`路径不存在: ${srcPath}`);
  }

  // 移除已有的目录或 symlink
  if (existsSync(dest)) {
    if (lstatSync(dest).isSymbolicLink()) {
      unlinkSync(dest);
    } else {
      rmSync(dest, { recursive: true, force: true });
    }
  }

  // 创建 junction（Windows 兼容，不需要管理员权限）
  symlinkSync(srcPath, dest, 'junction');

  log.title(`${mod.description} — 开发模式`);
  log.info(`${mod.destName}/ → ${srcPath}`);
  log.info('');
  log.info('现在可以直接在源仓库中编辑，vtour 中实时生效。');
  log.info(`完成开发后运行: pano dev --reset ${moduleName}`);
}

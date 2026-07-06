// @ts-check
import { existsSync, lstatSync, cpSync, copyFileSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { vtourDir, BuildError } from '../core/config.js';
import { log } from '../core/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'templates');

/**
 * pano upgrade — 升级已有项目的框架文件
 * 更新 panohper/ 和 tour.xml，不触碰 main.xml、hotspots/、panos/ 等用户数据。
 * @param {{ check?: boolean }} opts
 */
export async function cmdUpgrade(opts = {}) {
  const vdir = vtourDir();

  if (!existsSync(join(vdir, 'tour.html'))) {
    throw new BuildError('当前目录不是已初始化的 vtour 工程。请先运行 pano init。');
  }

  // --check: 仅检查是否有差异
  if (opts.check) {
    const diffs = checkDiffs(vdir);
    if (diffs.length === 0) {
      log.info('所有框架文件已是最新版本。');
    } else {
      log.title('以下文件可更新');
      for (const d of diffs) {
        log.info(`  ${d}`);
      }
      log.info('\n运行 pano upgrade 执行更新。');
    }
    return;
  }

  log.title('升级框架文件');

  // ── 升级 panohper/ ──
  const panohperDest = join(vdir, 'panohper');
  if (existsSync(panohperDest) && lstatSync(panohperDest).isSymbolicLink()) {
    log.warn('panohper/ 是 symlink（开发模式），跳过。');
    log.info('如需升级，请先 pano dev --reset panohper');
  } else {
    const panohperSrc = join(TEMPLATES_DIR, 'panohper');
    copyDir(panohperSrc, panohperDest);
    log.info('  ✓ panohper/ 已更新');
  }

  // ── 升级 tour.xml ──
  const tourDest = join(vdir, 'tour.xml');
  const tourSrc = join(TEMPLATES_DIR, 'tour.xml');
  copyFileSync(tourSrc, tourDest);
  log.info('  ✓ tour.xml 已更新');

  // ── 确保 main.xml 存在（不覆盖） ──
  // 兼容旧版：custom.xml / project.xml → main.xml 迁移
  const mainDest = join(vdir, 'main.xml');
  const oldProject = join(vdir, 'project.xml');
  const oldCustom = join(vdir, 'custom.xml');
  if (!existsSync(mainDest) && existsSync(oldProject)) {
    renameSync(oldProject, mainDest);
    log.info('  ✓ project.xml → main.xml（已迁移）');
  } else if (!existsSync(mainDest) && existsSync(oldCustom)) {
    renameSync(oldCustom, mainDest);
    log.info('  ✓ custom.xml → main.xml（已迁移）');
  } else if (!existsSync(mainDest)) {
    copyFileSync(join(TEMPLATES_DIR, 'main.xml'), mainDest);
    log.info('  + main.xml（新建）');
  } else {
    log.info('  · main.xml 保持不变');
  }

  // ── 复制 pano-runtime.js（热点运行时） ──
  const runtimeSrc = join(TEMPLATES_DIR, 'pano-runtime.js');
  const runtimeDest = join(vdir, 'pano-runtime.js');
  copyFileSync(runtimeSrc, runtimeDest);
  log.info('  ✓ pano-runtime.js 已更新');

  // ── 在 tour.html 中注入 pano-runtime.js 引用 ──
  const htmlPath = join(vdir, 'tour.html');
  if (existsSync(htmlPath)) {
    let html = readFileSync(htmlPath, 'utf-8');
    if (!html.includes('pano-runtime.js')) {
      html = html.replace(/<script src="tour\.js"><\/script>/, '<script src="tour.js"></script>\n<script src="pano-runtime.js"></script>');
      writeFileSync(htmlPath, html, 'utf-8');
      log.info('  ✓ tour.html 已注入 pano-runtime.js 引用');
    } else {
      log.info('  · tour.html 已包含 pano-runtime.js 引用');
    }
  }

  // ── 更新 WORKFLOW.md ──
  const workflowDest = join(vdir, 'WORKFLOW.md');
  copyFileSync(join(TEMPLATES_DIR, 'WORKFLOW.md'), workflowDest);
  log.info('  ✓ WORKFLOW.md 已更新');

  log.title('升级完成');
  log.info('main.xml 和 hotspots/ 中的用户数据未被修改。');
  log.info('如框架有新功能，请查看 WORKFLOW.md 了解变更。\n');
}

/**
 * 递归复制目录（覆盖已有文件）
 * @param {string} src
 * @param {string} dest
 */
function copyDir(src, dest) {
  cpSync(src, dest, { recursive: true, force: true });
}

/**
 * 检查框架文件是否与模板一致
 * @param {string} vdir
 * @returns {string[]} 有差异的文件列表
 */
function checkDiffs(vdir) {
  const diffs = [];

  // 检查 tour.xml
  const tourDest = join(vdir, 'tour.xml');
  const tourSrc = join(TEMPLATES_DIR, 'tour.xml');
  if (existsSync(tourDest)) {
    if (readFileSync(tourDest, 'utf-8') !== readFileSync(tourSrc, 'utf-8')) {
      diffs.push('tour.xml');
    }
  } else {
    diffs.push('tour.xml（缺失）');
  }

  // 检查 panohper/ 内的文件
  const panohperDest = join(vdir, 'panohper');
  if (existsSync(panohperDest) && !lstatSync(panohperDest).isSymbolicLink()) {
    const panohperSrc = join(TEMPLATES_DIR, 'panohper');
    compareDir(panohperSrc, panohperDest, 'panohper', diffs);
  }

  // 检查 main.xml 是否存在
  if (!existsSync(join(vdir, 'main.xml'))) {
    diffs.push('main.xml（缺失）');
  }

  return diffs;
}

/**
 * 递归比较目录文件
 * @param {string} srcDir
 * @param {string} destDir
 * @param {string} prefix
 * @param {string[]} diffs
 */
function compareDir(srcDir, destDir, prefix, diffs) {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const relPath = `${prefix}/${entry.name}`;
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      if (!existsSync(destPath)) {
        diffs.push(`${relPath}/（缺失）`);
      } else {
        compareDir(srcPath, destPath, relPath, diffs);
      }
    } else {
      if (!existsSync(destPath)) {
        diffs.push(`${relPath}（缺失）`);
      } else if (readFileSync(srcPath, 'utf-8') !== readFileSync(destPath, 'utf-8')) {
        diffs.push(relPath);
      }
    }
  }
}

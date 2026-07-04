#!/usr/bin/env node
// @ts-check

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { cmdCreate } from '../lib/commands/create.js';
import { cmdInit } from '../lib/commands/init.js';
import { cmdSync } from '../lib/commands/sync.js';
import { cmdXml } from '../lib/commands/xml.js';
import { cmdEditor } from '../lib/commands/editor.js';
import { cmdSave } from '../lib/commands/save.js';
import { cmdClean } from '../lib/commands/clean.js';
import { cmdPublish } from '../lib/commands/publish.js';
import { cmdUpgrade } from '../lib/commands/upgrade.js';
import { cmdServe } from '../lib/commands/serve.js';
import { cmdConfig } from '../lib/commands/config.js';
import { cmdDev } from '../lib/commands/dev.js';
import { setLogLevel } from '../lib/core/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('pano')
  .description('krpano 全景项目 CLI 工具')
  .version(pkg.version)
  .option('-v, --verbose', '详细输出')
  .option('-q, --quiet', '仅显示警告和错误')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) setLogLevel('debug');
    else if (opts.quiet) setLogLevel('warn');
  });

program
  .command('create <name>')
  .description('创建新全景项目骨架')
  .action(async (name) => {
    await cmdCreate(name);
  });

program
  .command('init')
  .description('初始化工程（生成 vtour 基础文件 + 全部瓦片 + XML）')
  .option('--repair', '修复缺失的框架文件（不重新生成瓦片）')
  .action(async (opts) => {
    await cmdInit(opts);
  });

program
  .command('sync')
  .description('生成瓦片 + 更新 XML')
  .option('--force', '强制重新生成所有瓦片')
  .option('--force-scene <name...>', '强制重新生成指定场景的瓦片，可传多个场景名')
  .action(async (opts) => {
    await cmdSync(opts);
  });

program
  .command('xml')
  .description('仅更新 XML（不生成瓦片）')
  .action(async () => {
    await cmdXml();
  });

program
  .command('editor')
  .description('进入编辑模式（内联场景到 tour.xml）')
  .action(async () => {
    await cmdEditor();
  });

program
  .command('save')
  .description('保存热点 + 恢复 include 模式')
  .action(async () => {
    await cmdSave();
  });

program
  .command('clean')
  .description('清除旧瓦片数据')
  .action(async () => {
    await cmdClean();
  });

program
  .command('publish')
  .description('打包发布文件')
  .option('--oss', '瓦片路径指向 OSS')
  .option('--skip-panos', '不打包 panos/，适用于全景瓦片未变化时的增量发布')
  .option('--compress-images', '压缩发布包中的非全景图片资源，减小包体')
  .action(async (opts) => {
    await cmdPublish(opts);
  });

program
  .command('serve')
  .description('启动本地预览服务器')
  .option('-p, --port <port>', '端口号（默认 8090）')
  .option('-e, --edit', '编辑模式（注入可视化编辑器）')
  .action(async (opts) => {
    const portSpecified = opts.port != null;
    await cmdServe({ port: portSpecified ? parseInt(opts.port) : 8090, portSpecified, edit: !!opts.edit });
  });

program
  .command('config')
  .description('查看或修改配置（支持 --global 全局配置）')
  .option('--krpano <path>', '设置 krpanotools 所在目录')
  .option('--source <dir>', '设置全景图源目录')
  .option('-g, --global', '操作全局配置（所有项目共享）')
  .action(async (opts) => {
    await cmdConfig(opts);
  });

program
  .command('dev [module] [path]')
  .description('链接本地模块进行开发（如 panohper）')
  .option('--reset', '恢复为内置版本')
  .option('--status', '查看链接状态')
  .action(async (moduleName, localPath, opts) => {
    await cmdDev(moduleName, localPath, opts);
  });

program
  .command('upgrade')
  .description('升级框架文件（panohper + tour.xml），不影响用户自定义内容')
  .option('--check', '仅检查是否有更新')
  .action(async (opts) => {
    await cmdUpgrade(opts);
  });

try {
  await program.parseAsync();
} catch (err) {
  // commander 已处理 help/version 退出
  if (err.code !== 'commander.helpDisplayed' && err.code !== 'commander.version') {
    console.error(err.message || err);
    process.exit(1);
  }
}

// @ts-check

/**
 * 复现 krpano 对中文文件名的编码算法。
 * 每个非 ASCII 字符的 UTF-8 字节按 chr((byte % 26 + 2) % 26 + ord('a')) 编码，
 * ASCII 字符保持不变。
 * @param {string} filename
 * @returns {string}
 */
export function krpanoEncode(filename) {
  const result = [];
  for (const ch of filename) {
    const buf = Buffer.from(ch, 'utf-8');
    if (buf.length === 1) {
      // krpano 将点号也替换为下划线用于瓦片目录名
      if (ch === '.') {
        result.push('_');
      } else {
        result.push(ch);
      }
    } else {
      for (const b of buf) {
        result.push(String.fromCharCode(((b % 26) + 2) % 26 + 97)); // ord('a') = 97
      }
    }
  }
  return result.join('');
}

/**
 * 自然排序 key — 数字按值排序而非字典序
 * @param {string} s
 * @returns {(string|number)[]}
 */
export function naturalSortKey(s) {
  return s.split(/(\d+)/).map(part => /^\d+$/.test(part) ? parseInt(part, 10) : part.toLowerCase());
}

/**
 * 转义 XML 特殊字符
 * @param {string} s
 * @returns {string}
 */
export function escapeXml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/*
 * 最小限の zip 作成 (無圧縮)。JPEG / PNG はすでに圧縮されているので、圧縮しても小さくならない。
 * ファイル名は UTF-8 で格納する (日本語のファイル名・フォルダ名に対応)。
 */
(function () {
  'use strict';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  }

  const LIMIT = 0xffffffff;

  class ZipWriter {
    constructor() {
      this.parts = [];      // Blob / Uint8Array をそのまま並べる (大きなデータを結合しない)
      this.central = [];
      this.offset = 0;
      this.count = 0;
      this.enc = new TextEncoder();
    }

    /** @param {string} path zip 内のパス (区切りは /)  @param {Blob} blob */
    async add(path, blob) {
      const data = new Uint8Array(await blob.arrayBuffer());
      const crc = crc32(data);
      const size = data.length;
      const name = this.enc.encode(path);
      if (this.offset + 30 + name.length + size > LIMIT) throw new Error('zip が 4GB を超えるため書き出せません。サイズを小さくするか、枚数を分けてください。');
      const { time, date } = dosDateTime(new Date());

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);          // 展開に必要なバージョン
      local.setUint16(6, 0x0800, true);      // ファイル名は UTF-8
      local.setUint16(8, 0, true);           // 無圧縮
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);

      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true);
      cen.setUint16(12, time, true);
      cen.setUint16(14, date, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, size, true);
      cen.setUint32(24, size, true);
      cen.setUint16(28, name.length, true);
      cen.setUint32(42, this.offset, true);

      this.parts.push(new Uint8Array(local.buffer), name, blob);
      this.central.push(new Uint8Array(cen.buffer), name);
      this.offset += 30 + name.length + size;
      this.count++;
    }

    /** @returns {Blob} */
    finish() {
      const cenSize = this.central.reduce((s, p) => s + p.length, 0);
      if (this.offset + cenSize > LIMIT || this.count > 0xffff) throw new Error('zip が大きすぎるため書き出せません。枚数を分けてください。');
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, this.count, true);
      end.setUint16(10, this.count, true);
      end.setUint32(12, cenSize, true);
      end.setUint32(16, this.offset, true);
      return new Blob([...this.parts, ...this.central, new Uint8Array(end.buffer)], { type: 'application/zip' });
    }
  }

  window.OSP = window.OSP || {};
  window.OSP.ZipWriter = ZipWriter;
  window.OSP.crc32 = crc32;
})();

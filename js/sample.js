/* 起動時に表示するサンプル画像 (手続き的に生成。写真素材は同梱しない) */
(function () {
  'use strict';

  function sphere(ctx, x, y, r, base, light, dark) {
    // 接地影
    ctx.save();
    ctx.translate(x + r * 0.25, y + r * 0.98);
    ctx.scale(1, 0.22);
    const sh = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 1.5);
    sh.addColorStop(0, 'rgba(20,12,8,0.55)');
    sh.addColorStop(1, 'rgba(20,12,8,0)');
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.05, x - r * 0.1, y - r * 0.1, r * 1.15);
    g.addColorStop(0, light);
    g.addColorStop(0.45, base);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function makeSample() {
    const W = 1600, H = 2000;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');

    // 背景紙
    let g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#d9cdbf');
    g.addColorStop(0.62, '#c9b8a6');
    g.addColorStop(0.64, '#b7a593');
    g.addColorStop(1, '#8e7c6c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    g = ctx.createRadialGradient(W * 0.38, H * 0.3, 50, W * 0.5, H * 0.45, H * 0.8);
    g.addColorStop(0, 'rgba(255,246,232,0.6)');
    g.addColorStop(0.5, 'rgba(255,246,232,0)');
    g.addColorStop(1, 'rgba(30,18,12,0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // ドレープ
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(W * 0.62, 0);
    ctx.bezierCurveTo(W * 0.5, H * 0.3, W * 0.86, H * 0.42, W * 0.7, H * 0.7);
    ctx.bezierCurveTo(W * 0.66, H * 0.8, W * 0.9, H * 0.86, W, H * 0.84);
    ctx.lineTo(W, 0);
    ctx.closePath();
    ctx.clip();
    g = ctx.createLinearGradient(W * 0.55, 0, W, H * 0.3);
    const stops = ['#7d1232', '#d8436b', '#f3a0b4', '#b02a55', '#e86f8f', '#8a1638', '#d3486f', '#f6b4c2', '#9c1f47'];
    stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    g = ctx.createLinearGradient(0, 0, 0, H * 0.86);
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // オブジェ
    sphere(ctx, W * 0.36, H * 0.5, 330, '#d9623b', '#ffd9b8', '#5a1608');
    sphere(ctx, W * 0.68, H * 0.66, 190, '#1f8f8a', '#c8f4e8', '#052f33');
    sphere(ctx, W * 0.2, H * 0.72, 130, '#e2b23a', '#fff3c4', '#6b4306');
    sphere(ctx, W * 0.5, H * 0.76, 105, '#e4b596', '#fff0e2', '#7a4630');
    sphere(ctx, W * 0.83, H * 0.77, 95, '#27408f', '#b9c9ff', '#070d2e');
    sphere(ctx, W * 0.36, H * 0.8, 78, '#1b1a1c', '#b8b4b0', '#000000');

    // 題字
    ctx.fillStyle = '#17120f';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 300px "Bodoni MT", Didot, "Playfair Display", "Times New Roman", serif';
    ctx.fillText('PRINT', W / 2, 330);
    ctx.font = '400 40px Helvetica, Arial, sans-serif';
    ctx.fillText('O N   S C R E E N   P R I N T E R   —   I S S U E   0 1', W / 2, 400);

    // グレースケール / カラーパッチ
    const n = 11, pw = (W - 200) / n, y0 = H - 150;
    for (let i = 0; i < n; i++) {
      const v = Math.round((i / (n - 1)) * 255);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(100 + i * pw, y0, pw + 1, 46);
    }
    const cols = ['#00a0e9', '#e4007f', '#fff100', '#e60012', '#009944', '#1d2088', '#f39800', '#8fc31f', '#920783', '#f6c9b0', '#7b5a44'];
    cols.forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.fillRect(100 + i * pw, y0 + 46, pw + 1, 46);
    });
    return c;
  }

  window.OSP = window.OSP || {};
  window.OSP.makeSample = makeSample;
})();

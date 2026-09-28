#!/usr/bin/env node
/**
 * Phone-width checks, in a real Firefox: no step scrolls sideways, controls are big
 * enough to touch, fields use 16 px text (so phones do not zoom in), and the step bar
 * scrolls within itself.
 *
 * Headless Firefox will not open a window narrower than 500 px, so the app runs inside
 * an iframe of the phone's width: an iframe has its own viewport, and the app's media
 * queries respond to it exactly as on the phone.
 *
 * Prerequisites: geckodriver --port 4444, and the app served.
 * Run:  node tools/mobile-smoke.mjs [appUrl] [driverUrl] [screenshotDir]
 */
import { session, checker } from './wd.mjs';

const APP = process.argv[2] ?? 'http://localhost:8000/';
const SHOTS = process.argv[4];
const s = await session({ driver: process.argv[3] ?? 'http://localhost:4444', width: 900, height: 1100 });
const { check, failures } = checker();
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
/** Run a script inside the framed app, with `document` and `window` bound to it. */
const f = (js, args = []) => s.exec(`const w = document.querySelector('iframe').contentWindow; return (function (document, window, localStorage) { ${js} })(w.document, w, w.localStorage);`, args);

try {
  for (const phone of [{ name: 'small Android', width: 360, height: 780 }, { name: 'iPhone 14 / Pixel 7', width: 390, height: 844 }]) {
    console.log(`\n${phone.name} (${phone.width} px)`);
    await s.go(APP);
    await s.exec(`localStorage.clear(); document.open(); document.write('<body style="margin:0;background:#888"><iframe src="${APP}" style="border:0;width:${phone.width}px;height:${phone.height}px;background:#fff"></iframe></body>'); document.close();`);
    await s.waitFor(`document.querySelector('iframe') && document.querySelector('iframe').contentDocument && document.querySelector('iframe').contentDocument.querySelector('main h1')`, 'the framed app');
    check('the app sees a phone-width viewport', (await f('return window.innerWidth')) === phone.width, String(await f('return window.innerWidth')));
    await f(`const y = document.getElementById('t-year'); y.value = '2025'; y.dispatchEvent(new Event('change', { bubbles: true }));`);
    await settle();
    await f(`[...document.querySelectorAll('.track input')][2].click();`);
    await settle();
    const steps = await f(`return [...document.querySelectorAll('#steps button')].map((b) => b.textContent.replace(/^\\d+/, ''))`);
    for (let i = 0; i < steps.length; i++) {
      await f(`document.querySelectorAll('#steps button')[${i}].click();`);
      await settle();
      const over = await f('return document.documentElement.scrollWidth - window.innerWidth');
      check(`${steps[i]}: no sideways scrolling`, over <= 1, `${over}px over`);
      const fonts = await f(`return [...document.querySelectorAll('main select, main input[type=text], main input[type=number], main input[type=date], main textarea')]
        .filter((e) => e.offsetParent).map((e) => parseFloat(getComputedStyle(e).fontSize))`);
      if (fonts.length) check(`${steps[i]}: fields use 16 px text`, fonts.every((x) => x >= 16), `smallest ${Math.min(...fonts)}px`);
      const small = await f(`return [...document.querySelectorAll('main button:not(.link), main select, main input[type=text], main input[type=number], main input[type=date]')]
        .filter((e) => e.offsetParent && e.getBoundingClientRect().height < 36).map((e) => e.outerHTML.slice(0, 60))`);
      if (small.length) check(`${steps[i]}: controls at least 36 px tall`, false, small.slice(0, 2).join(' | '));
      if (SHOTS && phone.width === 360) {
        await f('window.scrollTo(0,0)');
        await s.shot(`${SHOTS}/m-${i + 1}.png`);
      }
    }
    const nav = await f(`const n = document.getElementById('steps'); return { scrolls: n.scrollWidth > n.clientWidth, height: Math.round(n.getBoundingClientRect().height) }`);
    check('the step bar scrolls within itself instead of wrapping', nav.scrolls && nav.height < 70, JSON.stringify(nav));
    const head = await f(`return Math.round(document.querySelector('.top').getBoundingClientRect().height)`);
    check('the sticky header stays under a fifth of the screen', head < phone.height / 5, `${head}px`);
  }
} catch (err) {
  console.log(`  FAIL  ${err.message}`);
  process.exitCode = 1;
} finally {
  await s.end();
}
const n = failures();
console.log(`\n${n === 0 && !process.exitCode ? 'All phone checks passed.' : `${n} check(s) FAILED.`}\n`);
if (n) process.exitCode = 1;

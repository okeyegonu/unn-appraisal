/**
 * wd.mjs: a minimal WebDriver client for the browser suites (Firefox via geckodriver).
 */
export async function session({ driver = 'http://localhost:4444', width = 1280, height = 1400, prefs = {} } = {}) {
  const call = async (m, p, b) => {
    const r = await fetch(driver + p, { method: m, headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(j).slice(0, 400)}`);
    return j.value;
  };
  const s = await call('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { args: ['-headless', '-width', String(width), '-height', String(height)], prefs: { 'browser.download.folderList': 2, 'browser.download.dir': '/tmp', 'browser.helperApps.neverAsk.saveToDisk': 'application/pdf,application/json', ...prefs } } } } });
  const sid = s.sessionId;
  const exec = (script, args = []) => call('POST', `/session/${sid}/execute/sync`, { script, args });
  const execAsync = (script, args = []) => call('POST', `/session/${sid}/execute/async`, { script, args });
  const go = (url) => call('POST', `/session/${sid}/url`, { url });
  const waitFor = async (expr, label, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await exec(`return (${expr});`)) return;
      await new Promise((r) => setTimeout(r, 120));
    }
    throw new Error(`timed out waiting for: ${label}`);
  };
  const shot = async (path) => {
    const b64 = await call('GET', `/session/${sid}/screenshot`);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, Buffer.from(b64, 'base64'));
  };
  const setWindow = (w, h) => call('POST', `/session/${sid}/window/rect`, { width: w, height: h });
  const end = () => call('DELETE', `/session/${sid}`);
  return { exec, execAsync, go, waitFor, shot, setWindow, end };
}

export function checker() {
  let failures = 0;
  const check = (name, ok, detail = '') => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
    if (!ok) failures++;
  };
  return { check, failures: () => failures };
}

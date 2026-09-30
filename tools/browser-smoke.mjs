#!/usr/bin/env node
/**
 * End to end, in a real Firefox: a candidate goes from an empty device to a
 * downloaded booklet, and nothing they repeat makes the record grow.
 *
 * Prerequisites: geckodriver --port 4444, and the app served (./serve.sh).
 * Run:  node tools/browser-smoke.mjs [appUrl] [driverUrl]
 */
import { session, checker } from './wd.mjs';

const APP = process.argv[2] ?? 'http://localhost:8000/';
const s = await session({ driver: process.argv[3] ?? 'http://localhost:4444' });
const { check, failures } = checker();
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.SMOKE_SHOTS; // a directory: save screenshots of the main screens there
const shot = async (name) => { if (SHOTS) await s.shot(`${SHOTS}/${name}.png`); };

/* Helpers that act as a person would: type into a field, choose from a dropdown, press a button. */
const H = `
window.__t = {
  field(label) {
    const labels = [...document.querySelectorAll('main label, main .label')];
    const l = labels.find((x) => x.textContent.replace(/\\s*\\*$/, '').trim().startsWith(label));
    if (!l) throw new Error('no field ' + label);
    return l.htmlFor ? document.getElementById(l.htmlFor) : l.parentElement.querySelector('input,select,textarea');
  },
  type(label, value, form) {
    const el = form ? form.querySelector('#' + [...form.querySelectorAll('label')].find((x) => x.textContent.trim().replace(/\\s*\\*$/, '').startsWith(label)).htmlFor) : this.field(label);
    el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  },
  button(text, root = document) {
    const b = [...root.querySelectorAll('button, label.button')].find((x) => x.textContent.trim().startsWith(text));
    if (!b) throw new Error('no button ' + text);
    b.click();
  },
  step(label) {
    const b = [...document.querySelectorAll('#steps button')].find((x) => x.textContent.replace(/^\\d+/, '').startsWith(label));
    if (!b) throw new Error('no step ' + label);
    b.click();
  },
  form(list) { return [...document.querySelectorAll('main section')].find((sec) => sec.querySelector('h2').textContent.startsWith(list)).querySelector('form'); },
  record() { const r = localStorage.getItem('unn-appraisal'); return r; },
  count(list) { return JSON.parse(localStorage.getItem('unn-appraisal') || '{}')[list]?.length ?? 0; },
  async attach(slotLabel, name, type, bytes, entryText) {
    const scope = entryText ? [...document.querySelectorAll('.entry')].find((e) => e.querySelector('.what').textContent.includes(entryText)) : document;
    const slot = [...scope.querySelectorAll('.slot')].find((x) => x.querySelector('b').textContent.startsWith(slotLabel));
    const input = slot.querySelector('input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], name, { type }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  },
};
// Catch downloads at the download link, not by wrapping URL.createObjectURL: pdf.js uses
// that function too, and wrapping it stalled its page rendering.
if (!HTMLAnchorElement.prototype.__caught) {
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download') && this.href.startsWith('blob:')) {
      fetch(this.href).then((r) => r.blob()).then((b) => { window.__lastBlob = b; });
      return;
    }
    return click.call(this);
  };
  HTMLAnchorElement.prototype.__caught = true;
}
`;
const t = (js) => s.exec(`${H}; ${js}`);

/** A small real PDF, made by hand so the suite needs no fixtures. */
function pdfBytes(label) {
  const content = `BT /F1 24 Tf 72 720 Td (${label}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return [...Buffer.from(out, 'latin1')];
}
/** A 1x1 JPEG with an EXIF orientation tag, as a phone photograph carries. */
const JPEG = [...Buffer.from('/9j/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiiv/9k=', 'base64')];

try {
  await s.go(APP);
  await s.exec('localStorage.clear(); indexedDB.deleteDatabase("unn-appraisal-files");');
  await s.go(APP);
  await s.waitFor('document.querySelector("main h1")', 'the app');
  console.log('\nThe appraisal tab before anything is entered');
  await t(`__t.step('Appraisal')`);
  await settle();
  const idle = await s.exec(`const b = [...document.querySelectorAll('main button')].find((x) => x.textContent === 'Run the appraisal'); return { shown: Boolean(b), disabled: b && b.disabled, note: document.getElementById('run-needs')?.textContent || '' }`);
  check('tab 8 shows the Run button, greyed, before a track is chosen', idle.shown && idle.disabled);
  check('and says what tab 1 still needs', /your track/.test(idle.note) && /appraisal year/.test(idle.note));
  await t(`__t.step('Candidate')`);
  await settle();
  console.log('\nCandidate and track');
  await t(`__t.type('Name', 'Adaeze Ọkọnkwọ'); __t.type('Department', 'Mechanical Engineering'); __t.type('Faculty', 'Engineering');`);
  check('tab 1 shows a greyed SS.XXXX in the empty Staff No field', (await t(`return __t.field('Staff No').placeholder`)) === 'SS.XXXX');
  await t(`__t.type('Staff No', 'UNN/0001')`);
  check('a staff number not in the form SS.X is refused, and says how', /Begin with SS\./.test(await t(`return __t.field('Staff No').parentElement.querySelector('.help').textContent`))
    && JSON.parse(await t('return __t.record()') || '{}').candidate?.staff_no !== 'UNN/0001');
  await t(`__t.type('Staff No', 'SS.1234567890123')`);
  check('more than 12 digits is refused', /At most 12 digits/.test(await t(`return __t.field('Staff No').parentElement.querySelector('.help').textContent`)));
  await t(`const f = __t.field('Staff No'); f.value = 'ss 0001'; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('blur'));`);
  check('"ss 0001" is completed to SS.0001', (await t(`return __t.field('Staff No').value`)) === 'SS.0001' && JSON.parse(await t('return __t.record()')).candidate.staff_no === 'SS.0001');
  check('tab 1 shows a greyed 2025/2026 in the empty session field', (await t(`return __t.field('Appraisal year').placeholder`)) === '2025/2026');
  await t(`__t.type('Appraisal year', '2025/26')`);
  check('the abbreviation is refused by name', /Write the session in full: 2025\/2026/.test(await t(`return __t.field('Appraisal year').parentElement.querySelector('.help').textContent`)));
  check('and not recorded', JSON.parse(await t('return __t.record()') || '{}').track?.appraisal_year == null);
  await t(`__t.type('Appraisal year', '2025/2026')`);
  check('a typed session is spelt out', /1 October 2025 to 30 September 2026/.test(await t(`return __t.field('Appraisal year').parentElement.querySelector('.help').textContent`)));
  await settle();
  await t(`[...document.querySelectorAll('.track')].find((x) => x.textContent.startsWith('Lecturer I → Senior Lecturer')).querySelector('input').click();`);
  await settle();
  await t(`__t.type('Date of your last promotion', '2021-10-01');`);
  const tr = JSON.parse(await t('return __t.record()')).track;
  check('the track is recorded', tr.current_level === 2 && tr.target_level === 3 && tr.appraisal_year === 2025);
  check('the Igbo name is stored exactly', JSON.parse(await t('return __t.record()')).candidate.name === 'Adaeze Ọkọnkwọ');
  await t(`await 0; __t.attach('Letter of last promotion', 'promotion.pdf', 'application/pdf', ${JSON.stringify(pdfBytes('Letter of promotion'))});`.replace('await 0;', ''));
  await s.waitFor(`Object.keys(JSON.parse(localStorage.getItem('unn-appraisal')).attachments).length === 1`, 'the promotion letter to attach');
  check('the promotion letter is attached', true);

  console.log('\nQualifications, with a certificate PDF and a phone photograph');
  await t(`__t.step('Qualifications')`);
  await settle();
  const addQual = (kind, title, year) => t(`const f = __t.form('Academic'); const k = f.querySelector('select'); k.value='${kind}'; k.dispatchEvent(new Event('change',{bubbles:true}));`)
    .then(() => settle(100))
    .then(() => t(`const f = __t.form('Academic'); __t.type('Name of the qualification', '${title}', f); __t.type('Awarding university', 'University of Nigeria', f); __t.type('Year awarded', '${year}', f); __t.button('Add qualification', f);`));
  await addQual('masters', 'M.Eng. Mechanical Engineering', '2012');
  await settle();
  await addQual('doctorate', 'Ph.D. Mechanical Engineering', '2018');
  await settle();
  check('two qualifications', (await t('return __t.count("qualifications")')) === 2);
  await t(`const f = __t.form('Academic'); const k = f.querySelector('select'); k.value='doctorate'; k.dispatchEvent(new Event('change',{bubbles:true}));`);
  await settle(100);
  await t(`const f = __t.form('Academic'); __t.type('Name of the qualification', 'Ph.D. Mechanical Engineering', f); __t.type('Awarding university', 'University of Nigeria', f); for (let i = 0; i < 6; i++) __t.button('Add qualification', f);`);
  await settle();
  check('adding the same Ph.D. again, six times, adds nothing', (await t('return __t.count("qualifications")')) === 2);
  check('and says why', /already in the list/.test(await t('return document.querySelector("main form .msg").textContent')));
  await t(`__t.attach('Certificate', 'phd-certificate.pdf', 'application/pdf', ${JSON.stringify(pdfBytes('Ph.D. certificate'))}, 'Ph.D.')`);
  await s.waitFor(`JSON.parse(localStorage.getItem('unn-appraisal')).qualifications.some((q) => q.evidence.certificate)`, 'the certificate');
  await t(`const entry = [...document.querySelectorAll('.entry')].find((e) => e.querySelector('.what').textContent.includes('M.Eng.')); const input = entry.querySelector('.slot input[type=file]'); const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(${JSON.stringify(JPEG)})], 'meng-photo.jpg', { type: 'image/jpeg' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));`);
  await s.waitFor(`JSON.parse(localStorage.getItem('unn-appraisal')).qualifications.filter((q) => q.evidence.certificate).length === 2`, 'the photograph');
  check('a certificate can be a PDF or a photograph', true);
  await shot('qualifications');
  const before = await t('return Object.keys(JSON.parse(__t.record()).attachments).length');
  await t(`__t.attach('Certificate', 'phd-certificate-again.pdf', 'application/pdf', ${JSON.stringify(pdfBytes('Ph.D. certificate'))}, 'Ph.D.')`);
  await settle(600);
  check('the same file attached again is stored once', (await t('return Object.keys(JSON.parse(__t.record()).attachments).length')) === before);

  console.log('\nPublications');
  await t(`__t.step('Publications')`);
  await settle();
  const addWork = async (n, extra) => {
    await t(`const f = __t.form('Publications'); const k = f.querySelector('select'); k.value='journal_major'; k.dispatchEvent(new Event('change',{bubbles:true}));`);
    await settle(100);
    await t(`const f = __t.form('Publications');
      __t.type('Title', 'Thermal response of laterite bricks, part ${n}', f); __t.type('Number of authors', '2', f); __t.type('Year of publication', '${2016 + n}', f); __t.type('Journal', 'Journal ${n}', f);
      const role = [...f.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'first')); role.value = 'first'; role.dispatchEvent(new Event('change',{bubbles:true}));
      const cls = [...f.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'nigerian_a')); cls.value = '${extra.cls}'; cls.dispatchEvent(new Event('change',{bubbles:true}));`);
    await settle(100);
    await t(`const f = __t.form('Publications');
      const grade = [...f.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'A' && o.textContent === 'A')); grade.value = 'A'; grade.dispatchEvent(new Event('change',{bubbles:true}));
      ${extra.tr ? "const tr = [...f.querySelectorAll('label.check')].find((l) => l.textContent.startsWith('Thomson')).querySelector('input'); tr.click();" : ''}
      ${extra.sjr ? "const sj = [...f.querySelectorAll('label.check')].find((l) => l.textContent.startsWith('SCImago')).querySelector('input'); sj.click();" : ''}`);
    await settle(100);
    await t(`__t.button('Add work', __t.form('Publications'))`);
    await settle();
  };
  await addWork(1, { cls: 'international', tr: true });
  await addWork(2, { cls: 'international', sjr: true });
  await addWork(3, { cls: 'international', sjr: true });
  await addWork(4, { cls: 'nigerian_a' });
  await addWork(5, { cls: 'nigerian_a' });
  check('five works', (await t('return __t.count("items")')) === 5, `${await t('return __t.count("items")')}`);
  const first = await t(`return JSON.parse(__t.record()).items[0].id`);
  await t(`__t.attach('The publication itself', 'paper1.pdf', 'application/pdf', ${JSON.stringify(pdfBytes('Paper one'))})`);
  await s.waitFor(`JSON.parse(localStorage.getItem('unn-appraisal')).items.find((i) => i.id === '${first}').evidence.publication`, 'paper 1');
  check('the paper is attached to its own entry', true);

  console.log('\nResuming a half-typed entry');
  await t(`const f = __t.form('Publications'); __t.type('Title', 'A paper I have not finished entering', f);`);
  await settle(500);
  const recBefore = await t('return __t.record()');
  await s.go(APP);
  await s.waitFor('document.querySelector("main h1")', 'reload');
  check('the app reopens on the same step', (await s.exec('return document.querySelector("main h1").textContent')) === 'Publications and creative works');
  check('with the half-typed title restored', /not finished entering/.test(await s.exec(`return [...document.querySelectorAll('main form textarea')].map((x) => x.value).join('|')`)));
  check('and the record untouched by the draft', (await t('return __t.record()')) === recBefore);
  for (let i = 0; i < 3; i++) { await s.go(APP); await s.waitFor('document.querySelector("main h1")', 'reload'); }
  check('four reloads leave the record byte-identical', (await t('return __t.record()')) === recBefore);
  await t(`__t.button('Clear', __t.form('Publications'))`);

  console.log('\nTeaching, conferences, administration');
  await t(`__t.step('Teaching')`);
  await settle();
  for (const [sess, lvl, ev] of [[2021, 2, 80], [2022, 2, 82], [2023, 2, 85], [2024, 2, 84], [2025, 2, 86], [2016, 1, 75], [2017, 1, 75], [2018, 1, 75], [2019, 1, 75], [2020, 1, 75]]) {
    await t(`const f = __t.form('Teaching years'); __t.type('Session', '${sess}/${sess + 1}', f); const ki = f.querySelectorAll('select')[0]; ki.value='fulltime'; ki.dispatchEvent(new Event('change',{bubbles:true}));`);
    await settle(80);
    await t(`const f = __t.form('Teaching years'); const le = f.querySelectorAll('select')[1]; le.value='${lvl}'; le.dispatchEvent(new Event('change',{bubbles:true}));
      __t.type("Students' course-evaluation score", '${ev}', f); __t.button('Add year', f);`);
    await settle(120);
  }
  check('ten teaching years', (await t('return __t.count("teaching")')) === 10);
  await t(`__t.step('Conferences')`);
  await settle();
  for (const [n, sess] of [[1, 2021], [2, 2022], [3, 2022], [4, 2023], [5, 2024]]) {
    await t(`const f = __t.form('Conferences'); __t.type('Conference or workshop', 'NIMechE meeting ${n}', f);
      __t.type('Session', '${sess}', f);
      const le = f.querySelectorAll('select')[0]; le.value='2'; le.dispatchEvent(new Event('change',{bubbles:true}));
      [...f.querySelectorAll('label.check')].find((l) => l.textContent.startsWith('I read')).querySelector('input').click();`);
    await settle(80);
    await t(`__t.button('Add conference', __t.form('Conferences'))`);
    await settle(120);
  }
  check('five conferences', (await t('return __t.count("conferences")')) === 5);
  await t(`__t.step('Administration')`);
  await settle();
  await t(`const f = __t.form('Administrative'); const k = f.querySelector('select'); k.value='committee'; k.dispatchEvent(new Event('change',{bubbles:true}));`);
  await settle(100);
  const offices = await t(`return [...__t.form('Administrative').querySelectorAll('select')[1].options].map((o) => o.value).filter(Boolean)`);
  check('offices are a dropdown fitted to the kind of service', offices.join(',') === 'Chairman,Secretary,Member', offices.join(','));
  await t(`const f = __t.form('Administrative'); const [k, o, sc] = f.querySelectorAll('select');
    o.value='Member'; o.dispatchEvent(new Event('change',{bubbles:true})); sc.value='faculty'; sc.dispatchEvent(new Event('change',{bubbles:true}));
    __t.type('From session', '2021/2022', f); __t.type('Committee', 'Departmental Examinations Committee', f);`);
  await settle(80);
  await t(`__t.button('Add office', __t.form('Administrative'))`);
  await settle();
  check('one office', (await t('return __t.count("admin")')) === 1);

  console.log('\nThe appraisal run');
  await t(`__t.step('Appraisal')`);
  await settle();
  await t(`__t.button('Run the appraisal')`);
  await s.waitFor(`document.querySelector('.congrats, .verdict-bad, .verdict-q')`, 'the verdict', 30000);
  const verdict = await s.exec(`return document.querySelector('.congrats, .verdict-bad, .verdict-q').innerText`);
  check('Lecturer I → Senior Lecturer ends in congratulations', /Congratulations! You qualify for promotion to Senior Lecturer\./.test(verdict), verdict.split('\n')[0]);
  const colour = await s.exec(`return getComputedStyle(document.querySelector('.bar > div')).backgroundColor`);
  check('the bar ends bright green', colour === 'rgb(0, 230, 118)', colour);
  await s.exec('window.scrollTo(0, 0)'); await shot('run');
  const rec2 = await t('return __t.record()');
  await t(`__t.button('Run it again')`);
  await s.waitFor(`document.querySelector('.congrats')`, 'the second run', 30000);
  check('running it again changes nothing', (await t('return __t.record()')) === rec2);

  console.log('\nThe booklet');
  await t(`__t.step('Booklet')`);
  await settle();
  await t(`window.__lastBlob = null; __t.button('Download PDF')`);
  await s.waitFor(`window.__lastBlob && window.__lastBlob.type === 'application/pdf'`, 'the PDF', 60000);
  const pdf1 = await s.execAsync(`const done = arguments[0]; window.__lastBlob.arrayBuffer().then(async (b) => { const d = await crypto.subtle.digest('SHA-256', b); done({ size: b.byteLength, head: String.fromCharCode(...new Uint8Array(b).slice(0, 5)), hash: [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('') }); });`);
  check('a PDF booklet downloads', pdf1.head === '%PDF-' && pdf1.size > 50000, `${pdf1.size} bytes`);
  if (process.env.SMOKE_SAVE_PDF) {
    const b64 = await s.execAsync(`const done = arguments[0]; const r = new FileReader(); r.onload = () => done(r.result.split(',')[1]); r.readAsDataURL(window.__lastBlob);`);
    (await import('node:fs')).writeFileSync(process.env.SMOKE_SAVE_PDF, Buffer.from(b64, 'base64'));
  }
  const status = await s.exec(`return document.querySelector('main .msg[role=status]').textContent`);
  check('every attached document was included', /Done: \d+ pages\.$/.test(status), status);
  await t(`window.__lastBlob = null; __t.button('Download PDF')`);
  await s.waitFor(`window.__lastBlob && window.__lastBlob.type === 'application/pdf'`, 'the PDF again', 60000);
  const pdf2 = await s.execAsync(`const done = arguments[0]; window.__lastBlob.arrayBuffer().then(async (b) => { const d = await crypto.subtle.digest('SHA-256', b); done([...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('')); });`);
  check('making it again gives the same bytes', pdf2 === pdf1.hash);
  if (process.env.SMOKE_SAVE_BACKUP) {
    const text = await s.execAsync(`const done = arguments[0]; window.__lastBlob = null; document.getElementById('btn-backup').click();
      const wait = () => window.__lastBlob ? window.__lastBlob.text().then(done) : setTimeout(wait, 100); wait();`);
    (await import('node:fs')).writeFileSync(process.env.SMOKE_SAVE_BACKUP, text);
  }
  await s.exec('window.__appraisalDebug = true;');
  await t(`window.__lastBlob = null; __t.button('Download Word')`);
  await s.waitFor(`(window.__lastBlob && /wordprocessingml/.test(window.__lastBlob.type)) || /could not be made/.test(document.querySelector('main .msg[role=status]').textContent)`, 'the Word booklet', 240000);
  const wordStatus = await s.exec(`return document.querySelector('main .msg[role=status]').textContent`);
  if (/could not be made/.test(wordStatus)) throw new Error(wordStatus);
  const docx = await s.execAsync(`const done = arguments[0]; window.__lastBlob.arrayBuffer().then((b) => done({ size: b.byteLength, head: String.fromCharCode(...new Uint8Array(b).slice(0, 2)) }));`);
  check('a Word booklet downloads', docx.head === 'PK' && docx.size > 50000, `${docx.size} bytes`);

  if (SHOTS) {
    await s.setWindow(390, 844);
    await settle(400);
    await s.exec('window.scrollTo(0, 0)'); await shot('phone-booklet');
    await t(`__t.step('Appraisal')`); await settle(); await t(`__t.button('Run the appraisal')`);
    await s.waitFor(`document.querySelector('.congrats')`, 'the phone run', 30000);
    await s.exec(`document.querySelector('.congrats').scrollIntoView()`); await shot('phone-congrats');
    await t(`__t.step('Qualifications')`); await settle(); await shot('phone-qualifications');
    await s.setWindow(1280, 1400);
  }
  console.log('\nArrangement choices');
  await t(`__t.step('Booklet')`);
  await settle();
  await s.exec(`[...document.querySelectorAll('main .track')].find((l) => l.textContent.startsWith('Forms first')).querySelector('input').click();
    [...document.querySelectorAll('main .track')].find((l) => l.textContent.startsWith('Each document at its own size')).querySelector('input').click();`);
  await settle();
  const opts = JSON.parse(await t('return __t.record()')).options;
  check('the choices are saved with the dossier', opts.arrangement === 'forms_first' && opts.page_sizes === 'original', JSON.stringify(opts));
  await t(`window.__lastBlob = null; __t.button('Download PDF')`);
  await s.waitFor(`window.__lastBlob && window.__lastBlob.type === 'application/pdf'`, 'the forms-first PDF', 60000);
  const st2 = await s.exec(`return document.querySelector('main .msg[role=status]').textContent`);
  check('a forms-first booklet, documents at their own size, downloads', /^Done: \d+ pages\.$/.test(st2), st2);

  console.log('\nBackup and restore');
  const rec3 = await t('return __t.record()');
  const backup = await s.execAsync(`const done = arguments[0]; window.__lastBlob = null; document.getElementById('btn-backup').click();
    const wait = () => window.__lastBlob ? window.__lastBlob.text().then(done) : setTimeout(wait, 100); wait();`);
  check('the backup carries the files', JSON.parse(backup).files && Object.keys(JSON.parse(backup).files).length === Object.keys(JSON.parse(rec3).attachments).length);
  for (let i = 0; i < 2; i++) {
    await s.exec(`const input = document.getElementById('in-restore'); const dt = new DataTransfer(); dt.items.add(new File([arguments[0]], 'backup.json', { type: 'application/json' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));`, [backup]);
    await settle(1500);
  }
  check('restoring the same backup twice changes nothing', (await t('return __t.record()')) === rec3);
} catch (err) {
  console.log(`  FAIL  ${err.message}`);
  console.log('        status:', await s.exec(`return (document.querySelector('main .msg[role=status]') || {}).textContent || ''`).catch(() => '?'));
  console.log('        trace:', await s.exec(`return (window.__appraisalLog || []).slice(-8).join(' | ')`).catch(() => '?'));
  await s.shot('/tmp/unn-appraisal-smoke-failure.png').catch(() => {});
  process.exitCode = 1;
} finally {
  await s.end();
}
const f = failures();
console.log(`\n${f === 0 && !process.exitCode ? 'All browser checks passed.' : `${f} check(s) FAILED.`}\n`);
if (f) process.exitCode = 1;

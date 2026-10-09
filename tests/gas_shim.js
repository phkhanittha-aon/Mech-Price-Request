// จำลอง google.script.run / google.script.url / google.script.history ในเบราว์เซอร์ทดสอบ
// ให้หน้าเว็บทำงานเหมือนเปิดผ่าน /exec ของ Apps Script (ใช้ทดสอบเส้นทาง Google Sign-in) — ห้าม deploy
async function installGasShim(page, ctx) {
  await page.exposeFunction('__gasCall', (fn, args) => {
    try { return { ok: true, value: ctx[fn].apply(null, args) }; } catch (e) { return { ok: false, error: String(e) }; }
  });
  await page.addInitScript(() => {
    function runner(succ, fail) {
      const r = {
        withSuccessHandler: f => runner(f, fail), withFailureHandler: f => runner(succ, f),
        withUserObject: () => r
      };
      ['apiPost', 'apiGet'].forEach(fn => { r[fn] = (...args) => { window.__gasCall(fn, args).then(res => { setTimeout(() => res.ok ? (succ && succ(res.value)) : (fail && fail(new Error(res.error))), 0); }); }; });
      return r;
    }
    window.google = { script: {
      run: runner(null, null),
      url: { getLocation: cb => setTimeout(() => cb({ hash: (location.hash || '').replace(/^#/, ''), parameter: Object.fromEntries(new URLSearchParams(location.search)), parameters: {} }), 0) },
      history: { push: (s, p, h) => { history.pushState(null, '', '#' + (h || '')); }, setChangeHandler: () => {} }
    } };
  });
}
module.exports = { installGasShim };

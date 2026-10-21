/* ---------- boot ---------- */
renderModelPanel();
renderProps();
updateToolbar();
showPanel('model');
if (matchMedia('(max-width: 719px)').matches) app.classList.remove('sheet-open');
(async () => {
  try {
    const res = await fetch('sample.ifc');
    if (!res.ok) throw new Error('sample');
    await loadIfc(await res.arrayBuffer(), 'ukazkovy-pavilon.ifc');
    $('#sample-badge').hidden = false;
  } catch (e) {
    hideLoading();
    $('#empty-hint').hidden = false;
  }
  maybeStartTour();
})();
window.__ifc = S;
window.__ifcView = { camera, dataGroup, renderer, renderFrame, scene, findSnap, toScreen, currentPivot };

/* ---------- boot ---------- */
renderModelPanel();
renderProps();
updateToolbar();
showPanel('model');
if (isSheet()) setSheetOpen(false);
applySheet();
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
window.__ifcView = { camera, controls, dataGroup, renderer, renderFrame, scene, findSnap, toScreen, currentPivot, undoStack };

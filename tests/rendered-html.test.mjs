import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

test("server-renders the finished 松松逛 product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="zh-CN"/i);
  assert.match(html, /<title>松松逛｜虚拟购物与数字衣橱<\/title>/i);
  assert.match(html, /想买就先在这里拥有/);
  assert.match(html, /不用真的花钱/);
  assert.match(html, /不收集银行卡/);
  assert.match(html, /松松逛/);
  assert.match(html, /我的衣橱/);
  assert.match(html, /试穿间/);
  assert.match(html, /今日搭配/);
  assert.match(html, /href="#main-content"[^>]*>跳到主要内容</);
  assert.match(html, /<main[^>]+id="main-content"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps product storage, metadata, and 3D implementation wired", async () => {
  const [page, layout, app, deferredViews, shopView, closetView, studioView, dailyView, addDialog, deferredAddDialog, dialogAccessibility, avatar, avatarRuntime, deferredAvatar, wardrobeRoute, imageRoute, profileRoute, personalDataRoute, hosting, packageJson, requestOwner, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MuseApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/DeferredMuseViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ShopView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ClosetView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/StudioView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/DailyView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AddGarmentDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/DeferredAddGarmentDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/use-dialog-accessibility.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/Avatar3D.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/avatar-runtime.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/components/DeferredAvatar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/wardrobe/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/wardrobe/image/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/profile/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/personal-data/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/request-owner.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<MuseApp[^>]+storageOwner=/);
  assert.match(page, /key=\{user\?\.email \?\? "device"\}/);
  assert.match(page, /const pageOwner = user\?\.email \?\? localOwner/);
  assert.match(page, /ownerBindingForOwner\(pageOwner\)/);
  assert.match(page, /expectedOwner=\{expectedOwner\}/);
  assert.match(layout, /松松逛｜虚拟购物与数字衣橱/);
  assert.match(layout, /\/og\.jpg/);
  assert.match(layout, /\/favicon-48\.png/);
  assert.match(app, /VIRTUAL SHOPPING/);
  assert.match(app, /<DeferredAddGarmentDialog/);
  assert.match(app, /<DeferredShopView/);
  assert.match(app, /<DeferredClosetView/);
  assert.match(app, /<DeferredStudioView/);
  assert.match(app, /<DeferredDailyView/);
  assert.doesNotMatch(app, /function AddGarmentDialog|ADD TO WARDROBE/);
  assert.match(addDialog, /不会凭一张照片猜测厘米数/);
  assert.match(addDialog, /只提取明确标注的尺寸/);
  assert.match(closetView, /清除我的全部资料/);
  assert.match(app, /本机已保存/);
  assert.match(app, /正在本机保存/);
  assert.match(app, /className="external-update"/);
  assert.match(app, /另一标签页有新修改/);
  assert.match(app, /crossTabSnapshotAction/);
  assert.match(app, /lastKnownSnapshotRaw/);
  assert.match(app, /navigator\.locks\.request/);
  assert.match(app, /CLEAR_BOUNDARY_LOCK_NAME/);
  assert.match(app, /runClearBoundaryTask/);
  assert.match(app, /scrubSnapshotAfterClear/);
  assert.match(app, /currentEnvelope\.clearSignal === scrubSignal/);
  assert.match(app, /clearMarkerWriteAction/);
  assert.match(app, /newestClearSignal/);
  assert.match(app, /clearMarkerHydrationAction/);
  assert.match(app, /serializeCompletedClearMarker/);
  assert.match(app, /serializeFailedClearMarker/);
  const externalSnapshotSource = app.slice(
    app.indexOf("const considerExternalSnapshot"),
    app.indexOf("const handlePageShow"),
  );
  assert.ok(
    externalSnapshotSource.indexOf("scrubSnapshotAfterClear") <
      externalSnapshotSource.indexOf("crossTabSnapshotAction"),
    "cross-clear stale snapshots must be scrubbed before ordinary conflict handling",
  );
  assert.match(app, /observedClearSignal\.current !== clearSignalAtWrite/);
  assert.match(app, /persistedLocalChangeGeneration\.current = Math\.max/);
  assert.match(app, /unlockedDeviceWritePending\.current/);
  assert.match(app, /profileRevision/);
  assert.match(app, /expectedRevision: profileRevision\.current/);
  assert.match(app, /mutationEpoch\.current !== job\.requestEpoch/);
  assert.match(app, /检测到另一标签页的新修改；自动保存已暂停/);
  assert.match(app, /`保存状态：\$\{dataMode\}`/);
  assert.match(app, /const dataModeRef = useRef<DataMode>\(dataMode\)/);
  const autosaveSource = app.slice(
    app.indexOf('if (!ready || !hydrated.current || dataModeRef.current === "连接中")'),
    app.indexOf("const flushDeviceState"),
  );
  assert.match(autosaveSource, /const currentDataMode = dataModeRef\.current/);
  assert.doesNotMatch(
    autosaveSource,
    /dailyPreferences, dataMode, requestDeviceSnapshotWrite/,
    "save-status updates must not enqueue a second full device snapshot",
  );
  assert.match(app, /Promise\.allSettled/);
  assert.match(app, /headers\.set\(EXPECTED_OWNER_HEADER, expectedOwner \?\? ""\)/);
  assert.match(app, /const privateReadHeaders = \{ \[EXPECTED_OWNER_HEADER\]: expectedOwner \?\? "" \}/);
  assert.match(app, /handleSessionChangedResponse\(response\)/);
  const sessionChangedSource = app.slice(
    app.indexOf("const handleSessionChangedResponse"),
    app.indexOf("function fetchCloudMutation"),
  );
  assert.match(sessionChangedSource, /mutationEpoch\.current \+= 1/);
  assert.match(sessionChangedSource, /profileSaveQueue\.current\?\.clear\(\)/);
  assert.match(sessionChangedSource, /pendingCloudMutations\.current\.forEach[\s\S]*?controller\.abort\(\)/);
  assert.match(sessionChangedSource, /window\.location\.reload\(\)/);
  const clearRecoverySource = app.slice(
    app.indexOf("const recoveryControllers"),
    app.indexOf("const hydrateDeviceState"),
  );
  assert.match(clearRecoverySource, /\[EXPECTED_OWNER_HEADER\]: expectedOwner \?\? ""/);
  assert.match(clearRecoverySource, /handleSessionChangedResponse\(response\)/);
  assert.match(app, /localSnapshotKey\(storageOwner\)/);
  assert.match(app, /isClearedLocalSnapshot/);
  assert.match(app, /const backgroundInert = clearingData \|\| cartOpen \|\| addOpen \|\| celebrationOpen/);
  assert.match(app, /inert=\{backgroundInert \? true : undefined\}/);
  assert.match(app, /href="#main-content"/);
  assert.match(app, /id="main-content"/);
  assert.match(shopView, /className="product-grid">/);
  assert.doesNotMatch(shopView, /className="product-grid"[^>]*aria-live/);
  assert.match(shopView, /resultAnnouncement/);
  assert.match(closetView, /deleteAndRestoreFocus/);
  assert.match(shopView, /toggleSavedAndRestoreFocus/);
  assert.match(shopView, /query\.trim\(\)\.toLocaleLowerCase\("zh-CN"\)/);
  assert.match(studioView, /const inputValue = draft\.source === value/);
  assert.doesNotMatch(studioView, /key=\{value\} type="number"/);
  assert.match(closetView, /loading="lazy" decoding="async"/);
  assert.match(studioView, /loading="lazy" decoding="async"/);
  assert.match(addDialog, /<div[^>]*id="garment-submit-error"[^>]*role="alert"[^>]*>/);
  assert.match(addDialog, /aria-errormessage=\{importError/);
  assert.match(addDialog, /maxLength=\{MAX_GARMENT_NAME_LENGTH\}/);
  assert.match(addDialog, /maxLength=\{MAX_GARMENT_SOURCE_URL_LENGTH\}/);
  assert.match(addDialog, /isValidGarmentSourceUrl\(trimmedSourceUrl\)/);
  assert.match(addDialog, /sourceUrlInputRef\.current\?\.focus\(\)/);
  assert.match(addDialog, /file\.size === 0/);
  assert.match(addDialog, /这张图片没有内容/);
  assert.match(app, /浏览器阻止清除本机副本/);
  assert.match(app, /preservePersistedPhotos/);
  assert.match(addDialog, /invalidateRecognizedMeasurements/);
  assert.doesNotMatch(addDialog, /import \{ extractGarmentMeasurements \} from/);
  assert.match(addDialog, /await import\(\s*"\.\.\/lib\/garment-analysis\.mjs"\s*\)/);
  assert.match(addDialog, /estimateGeneration\.current !== requestGeneration/);
  assert.match(
    addDialog,
    /function setManualMeasurement[\s\S]*?estimateGeneration\.current \+= 1;[\s\S]*?setAnalyzing\(false\)/,
  );
  assert.match(addDialog, /<p[^>]*id="link-import-error"[^>]*className="import-error"[^>]*role="alert"[^>]*>/);
  const changeModeSource = addDialog.slice(
    addDialog.indexOf("function changeMode"),
    addDialog.indexOf("function runEstimate"),
  );
  assert.doesNotMatch(
    changeModeSource,
    /setPhoto\(|setPreview\(|setSourceUrl\(|setSizeChartText\(|revokeObjectURL/,
    "switching input tabs must preserve each mode's draft",
  );
  assert.match(deferredAddDialog, /lazy\(\(\) =>\s*import\("\.\/AddGarmentDialog"\)/);
  assert.match(deferredAddDialog, /<Suspense/);
  assert.match(deferredAddDialog, /正在打开录入窗口/);
  assert.match(deferredAddDialog, /role="status"/);
  assert.match(deferredAddDialog, /AddGarmentDialogLoadBoundary/);
  assert.match(deferredAddDialog, /录入窗口暂时没有打开/);
  assert.match(deferredAddDialog, /role="alert"/);
  assert.match(deferredAddDialog, /setLazyAddGarmentDialog\(\(\) => nextLazyAddGarmentDialog\)/);
  assert.match(deferredAddDialog, /setLoadAttempt\(\(current\) => current \+ 1\)/);
  assert.match(deferredAddDialog, /onRetry=\{retryLoad\}/);
  for (const viewName of ["ShopView", "ClosetView", "StudioView", "DailyView"]) {
    assert.match(deferredViews, new RegExp(`import\\(\"\\./${viewName}\"\\)`));
  }
  assert.match(deferredViews, /<Suspense/);
  assert.match(deferredViews, /ViewLoadBoundary/);
  assert.match(deferredViews, /role="status" aria-live="polite" aria-busy="true"/);
  assert.match(deferredViews, /role="alert"/);
  assert.match(deferredViews, /重新加载\{label\}/);
  assert.match(deferredViews, /headingRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(deferredViews, /<h1 ref=\{headingRef\} tabIndex=\{-1\}>/);
  assert.match(deferredViews, /<ViewReadySignal onReady=\{onReady\}/);
  assert.match(app, /onReady=\{focusCurrentViewHeading\}/);
  assert.match(dialogAccessibility, /returnTarget\.closest\("\[inert\]"\)/);
  assert.match(app, /dailyPreferences/);
  assert.match(app, /profilePending/);
  assert.match(app, /resolveHydratedProfile/);
  assert.match(app, /保留了尚未确认同步的本机分身参数/);
  assert.match(app, /profileEditGeneration\.current === job\.editGeneration/);
  assert.match(app, /createSerialLatestQueue\(executeProfileSave\)/);
  assert.match(app, /profileSaveQueue\.current\?\.running/);
  assert.match(app, /await queueProfileSave\(\{/);
  assert.match(app, /最新调整正在排队保存/);
  assert.match(studioView, /disabled=\{profileSaving\}/);
  assert.match(app, /if \(incompatibleSnapshot\.current\) return "incompatible"/);
  assert.match(app, /deviceGenerationAction\([\s\S]*?incompatibleSnapshot\.current/);
  assert.match(app, /generationAction === "reset-known"/);
  assert.match(app, /当前版本不会覆盖它/);
  assert.match(dailyView, /rankOutfitSelections/);
  assert.match(app, /avatarOutfitFromSelection\(outfit, wardrobe\)/);
  assert.match(app, /updateOutfit\(\(current\) => wearWardrobeItem\(current, item\)\)/);
  assert.match(app, /setPendingTryOnAnnouncement\([\s\S]*?wearWardrobeItemAnnouncement/);
  assert.match(app, /initialOutfitStatus=\{pendingTryOnAnnouncement\}/);
  assert.match(app, /onInitialOutfitStatusAnnounced=\{clearPendingTryOnAnnouncement\}/);
  assert.match(studioView, /item\.category === "上装" && item\.id === outfit\.topId/);
  assert.match(studioView, /const selectedIds = selected\.map\(\(item\) => item\.id\)/);
  assert.match(
    app,
    /onApply=\{\(selection\) => \{\s*updateOutfit\(selection\);\s*navigate\("studio"\);/,
  );
  assert.match(app, /<DeferredAvatar metrics=\{metrics\} outfit=\{avatarOutfit\} compact \/>/);
  assert.match(studioView, /<DeferredAvatar metrics=\{metrics\} outfit=\{avatarOutfit\} priority \/>/);
  assert.match(app, /pendingMutations\.map\(\(mutation\) => mutation\.promise\)/);
  assert.match(app, /CLOUD_MUTATION_TIMEOUT_MS/);
  assert.match(app, /CLOUD_UPLOAD_TIMEOUT_MS/);
  assert.match(app, /import\("\.\.\/lib\/wardrobe-photo"\)/);
  assert.match(app, /preparedPhoto\?\.deviceImage/);
  assert.match(app, /preparedPhoto\?\.upload \?\? photo/);
  assert.doesNotMatch(app, /function photoToDeviceImage/);
  assert.match(app, /pendingMutations\.forEach\(\(mutation\) => mutation\.controller\.abort\(\)\)/);
  assert.match(app, /BroadcastChannel\("songsong-closet:coordination:v1"\)/);
  assert.match(app, /snapshotMatchesClearSignal/);
  assert.match(app, /wardrobeCloudId/);
  assert.match(app, /\/api\/personal-data/);
  assert.ok(
    app.indexOf("latestSnapshot.current = emptySnapshot") <
      app.indexOf('"/api/personal-data"'),
    "device state must be cleared before cloud deletion begins",
  );
  assert.match(app, /cloudItemIds\.current\.has/);
  assert.match(app, /savedProductIds/);
  assert.match(avatar, /WebGLRenderer/);
  assert.match(avatar, /OrbitControls/);
  assert.match(avatar, /webglcontextlost/);
  assert.match(avatar, /forceContextLoss/);
  assert.match(avatar, /1000 \/ 30/);
  assert.match(avatar, /controls\.update\(deltaSeconds\)/);
  assert.match(avatar, /runtimeRef/);
  assert.match(avatar, /disposeObject3D\(object, runtime\.resources\)/);
  assert.match(
    avatar,
    /disposeObject3D\(scene, resources\);\s*disposeAvatarResources\(resources\);/,
  );
  assert.match(avatar, /disposeObject3D\(avatar, resources\)/);
  assert.match(avatar, /new ResizeObserver\(handleResize\)/);
  assert.match(avatar, /window\.addEventListener\("resize", handleResize\)/);
  assert.match(avatar, /window\.removeEventListener\("resize", handleResize\)/);
  assert.match(avatar, /createVisibleTimeBudget\(AVATAR_AUTO_ROTATE_MS\)/);
  assert.match(avatar, /avatarPixelRatio/);
  assert.match(
    avatar,
    /aria-label="缩小三维分身"[\s\S]*?onClick=\{\(\) => changeZoom\("out"\)\}/,
  );
  assert.match(
    avatar,
    /aria-label="放大三维分身"[\s\S]*?onClick=\{\(\) => changeZoom\("in"\)\}/,
  );
  assert.match(avatar, /const AVATAR_ZOOM_SCALE = 1 \/ 1\.15/);
  assert.match(avatar, /controls\.dollyIn\(AVATAR_ZOOM_SCALE\)/);
  assert.match(avatar, /controls\.dollyOut\(AVATAR_ZOOM_SCALE\)/);
  assert.match(avatar, /AVATAR_ZOOM_ANNOUNCE_DELAY_MS = 200/);
  assert.match(avatar, /三维分身已加载，当前缩放 \{announcedZoomLevel\}%/);
  assert.match(
    avatar,
    /useState<"initializing" \| "ready" \| "failed">\(\s*"initializing"/,
  );
  assert.match(
    avatar,
    /if \(renderFrame\(\)\) \{[\s\S]*?isActiveAvatarRuntime\(runtimeRef\.current, runtime, tornDown\)[\s\S]*?setRenderStatus\("ready"\)/,
  );
  assert.match(avatar, /renderer\.getContext\(\)\.isContextLost\(\)/);
  assert.match(
    avatar,
    /const initializationFrame = window\.requestAnimationFrame\([\s\S]*?window\.cancelAnimationFrame\(initializationFrame\)/,
  );
  assert.match(
    avatar,
    /const renderReady = renderStatus === "ready";[\s\S]*?!renderReady \?[\s\S]*?正在启动三维预览[\s\S]*?aria-label="三维分身已加载/,
  );
  assert.match(avatar, /const armGeo = new CapsuleGeometry/);
  assert.doesNotMatch(avatar, /armGeo\.clone\(\)|legGeo\.clone\(\)/);
  assert.match(studioView, /aria-labelledby="studio-closet-title"/);
  assert.match(studioView, /aria-labelledby="studio-body-title"/);
  assert.match(studioView, /id="studio-closet-title"/);
  assert.match(studioView, /id="studio-body-title"/);
  assert.match(studioView, /role="status" aria-live="polite" aria-atomic="true">\{outfitStatus\}/);
  assert.match(studioView, /setOutfitStatus\(initialOutfitStatus\)/);
  assert.match(studioView, /onInitialOutfitStatusAnnounced\?\.\(\)/);
  assert.match(avatar, /buildAvatar\(initialInput\.metrics, initialInput\.outfit, reducedDetail, resources\)/);
  assert.match(avatar, /runtime\.reducedDetail,\s*runtime\.resources,/);
  assert.match(avatarRuntime, /disposeAvatar\(previousAvatar\)/);
  assert.match(avatarRuntime, /shadowMap\.needsUpdate = true/);
  assert.doesNotMatch(avatar, /\[sceneMetrics, sceneOutfit, compact, retryVersion\]/);
  assert.match(avatar, /role="group"/);
  assert.match(deferredAvatar, /requestIdleCallback/);
  assert.match(deferredAvatar, /saveData/);
  assert.match(deferredAvatar, /AvatarErrorBoundary/);
  assert.match(deferredAvatar, /catch\(\(\) =>/);
  assert.match(deferredAvatar, /setForceLoad\(true\)/);
  assert.match(addDialog, /aria-label="上传或更换衣物正面照"/);
  assert.match(addDialog, /role="tabpanel"[\s\S]*?aria-busy=\{analyzing\}/);
  assert.match(addDialog, /className="analysis-result"[\s\S]*?aria-atomic="true"/);
  assert.match(app, /role="status" aria-live="polite" aria-atomic="true">\{removalStatus\}/);
  assert.match(app, /aria-describedby="cart-payment-note cart-checkout-note"/);
  assert.match(shopView, /className="chip-row" role="group" aria-label="商品筛选"/);
  assert.match(app, /aria-valuetext=\{`放松程度 \$\{mood\}%`\}/);
  assert.match(addDialog, /正在保存衣物，请稍候/);
  assert.match(addDialog, /if \(submitting \|\| analyzing\) return/);
  assert.match(addDialog, /disabled=\{submitting \|\| analyzing\}/);
  const addDialogSource = addDialog.slice(
    addDialog.indexOf("export function AddGarmentDialog"),
  );
  assert.ok(
    addDialogSource.indexOf('role="status"') < addDialogSource.indexOf("<form"),
    "garment progress announcements must stay outside the busy form",
  );
  assert.doesNotMatch(app, /className="hydration-status" role="status"/);
  assert.match(wardrobeRoute, /datetime\('now', '-10 minutes'\)/);
  assert.match(wardrobeRoute, /ALLOWED_IMAGE_TYPES/);
  assert.match(wardrobeRoute, /photo\.size === 0/);
  assert.match(wardrobeRoute, /isValidGarmentSourceUrl\(sourceUrl\)/);
  assert.match(wardrobeRoute, /db\.batch/);
  assert.match(wardrobeRoute, /wardrobe_image_cleanup/);
  assert.match(wardrobeRoute, /crc32/);
  assert.match(wardrobeRoute, /requestWithLimitedBody/);
  assert.match(wardrobeRoute, /reader\.cancel/);
  assert.match(wardrobeRoute, /headers\.delete\("transfer-encoding"\)/);
  assert.match(wardrobeRoute, /owner_data_generations/);
  assert.match(wardrobeRoute, /wardrobe_sync_keys/);
  assert.match(wardrobeRoute, /state = 'deleted'/);
  assert.match(wardrobeRoute, /wardrobeCloudId/);
  assert.match(wardrobeRoute, /requireExpectedOwner\(request\)/);
  assert.match(wardrobeRoute, /\[EXPECTED_OWNER_QUERY\]: expectedOwner/);
  assert.match(imageRoute, /requireExpectedOwner\(request, \{ allowQuery: true \}\)/);
  assert.match(profileRoute, /expectedRevision/);
  assert.match(profileRoute, /requireExpectedOwner\(request\)/);
  assert.match(profileRoute, /profile revision conflict/);
  assert.match(profileRoute, /revision = body_profiles\.revision \+ 1/);
  assert.match(profileRoute, /ALTER TABLE body_profiles ADD COLUMN revision/);
  assert.match(personalDataRoute, /db\.batch/);
  assert.match(personalDataRoute, /personal_data_clear_operations/);
  assert.match(personalDataRoute, /personal_data_clear_images/);
  assert.match(personalDataRoute, /FROM wardrobe_image_cleanup/);
  assert.match(personalDataRoute, /retry-after/);
  assert.match(personalDataRoute, /DELETE FROM body_profiles/);
  assert.match(personalDataRoute, /DELETE FROM wardrobe_items/);
  assert.match(personalDataRoute, /requireExpectedOwner\(request\)/);
  assert.match(requestOwner, /EXPECTED_OWNER_HEADER = "x-songsong-expected-owner"/);
  assert.match(requestOwner, /SESSION_CHANGED_HEADER = "x-songsong-session-status"/);
  assert.match(requestOwner, /crypto\.subtle\.digest/);
  assert.match(requestOwner, /status: 409/);
  assert.match(requestOwner, /code: "SESSION_CHANGED"/);
  assert.match(styles, /\.save-button, \.icon-button, \.cart-list article > button \{ min-width: 44px; \}/);
  assert.match(styles, /\.choice-group legend \{[^}]*font-size: 11px;/);
  assert.match(styles, /\.upload-zone:focus-within/);
  assert.match(styles, /\.daily-date small \{[\s\S]*?font-size: 10px;/);
  assert.match(styles, /\.drawer-footer > small \{[\s\S]*?font-size: 11px;/);
  assert.match(styles, /\.measurement-grid > label > span \{[\s\S]*?font-size: 10px;/);
  assert.match(styles, /@media \(pointer: coarse\)/);
  assert.match(
    styles,
    /@media \(max-width: 980px\) \{[\s\S]*?\.sync-state \{ display: inline-flex; \}/,
  );
  assert.doesNotMatch(styles, /\.top-actions \.sync-state \{ display: none; \}/);
  assert.match(styles, /\.skip-link:focus/);
  assert.match(styles, /^\*,\s*\n\*::before,\s*\n\*::after \{/);
  assert.match(styles, /\.external-update \{/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": "WARDROBE_IMAGES"/);
  assert.match(packageJson, /"three"/);
  assert.match(packageJson, /"typecheck"/);
  assert.doesNotMatch(requestOwner, /private-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(packageJson, /tailwind/i);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await access(new URL("../drizzle/0000_complex_lady_deathstrike.sql", import.meta.url));
  await access(new URL("../drizzle/0002_rapid_cerise.sql", import.meta.url));
  await access(new URL("../drizzle/0003_smart_james_howlett.sql", import.meta.url));
  await access(new URL("../drizzle/0004_ambiguous_nitro.sql", import.meta.url));
  await access(new URL("../app/api/wardrobe/route.ts", import.meta.url));
  await access(new URL("../app/api/profile/route.ts", import.meta.url));
  await assert.rejects(access(new URL("../postcss.config.mjs", import.meta.url)));
});

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((value) => Number.parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrastRatio(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

test("critical secondary text colors meet WCAG AA contrast", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const muted = styles.match(/--muted:\s*(#[0-9a-f]{6})/i)?.[1];
  const pathCopy = styles.match(/\.path-card p \{[\s\S]*?color:\s*(#[0-9a-f]{6})/i)?.[1];
  const studioDisclaimer = styles.match(
    /\.studio-disclaimer p \{[\s\S]*?color:\s*(#[0-9a-f]{6})/i,
  )?.[1];
  const fitCopy = styles.match(
    /\.fit-readout span,[\s\S]*?color:\s*(#[0-9a-f]{6})/i,
  )?.[1];
  const fitResult = styles.match(
    /\.fit-readout b \{[\s\S]*?color:\s*(#[0-9a-f]{6})/i,
  )?.[1];
  const recognitionBadge = styles.match(
    /\.form-section-title span \{[\s\S]*?color:\s*(#[0-9a-f]{6})/i,
  )?.[1];
  assert.ok(muted);
  assert.ok(pathCopy);
  assert.ok(studioDisclaimer);
  assert.ok(fitCopy);
  assert.ok(fitResult);
  assert.ok(recognitionBadge);
  assert.ok(contrastRatio(muted, "#e5e9e1") >= 4.5);
  assert.ok(contrastRatio(pathCopy, "#e7c7bb") >= 4.5);
  assert.ok(contrastRatio(pathCopy, "#cbc7dd") >= 4.5);
  assert.ok(contrastRatio(studioDisclaimer, "#eee8df") >= 4.5);
  assert.ok(contrastRatio(fitCopy, "#e7eae3") >= 4.5);
  assert.ok(contrastRatio(fitResult, "#e7eae3") >= 4.5);
  assert.ok(contrastRatio(recognitionBadge, "#eee3cf") >= 4.5);
});

test("critical product labels stay readable and touch ranges keep a usable hit area", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const ruleBody = (pattern) => styles.match(pattern)?.[1] ?? "";
  const fontSize = (body) => Number(body.match(/font-size:\s*(\d+)px/)?.[1] ?? 0);
  for (const [label, body] of [
    ["source labels", ruleBody(/\.virtual-pill,\s*\.source-pill\s*\{([^}]*)\}/)],
    ["product metadata", ruleBody(/\.product-meta\s*\{([^}]*)\}/)],
    ["wardrobe metadata", ruleBody(/\.wardrobe-info > div:first-child\s*\{([^}]*)\}/)],
    ["confidence label", ruleBody(/\.confidence-line span\s*\{([^}]*)\}/)],
    ["confidence badge", ruleBody(/\.confidence\s*\{([^}]*)\}/)],
    ["mobile navigation", ruleBody(/\.mobile-nav button\s*\{([^}]*)\}/)],
  ]) {
    assert.ok(fontSize(body) >= 10, `${label} fell below 10px`);
  }

  const mid = styles.match(
    /\.confidence--mid \{ background: (#[0-9a-f]{6}); color: (#[0-9a-f]{6}); \}/i,
  );
  const low = styles.match(
    /\.confidence--low \{ background: (#[0-9a-f]{6}); color: (#[0-9a-f]{6}); \}/i,
  );
  assert.ok(mid);
  assert.ok(low);
  assert.ok(contrastRatio(mid[2], mid[1]) >= 4.5);
  assert.ok(contrastRatio(low[2], low[1]) >= 4.5);

  const sourceRule = ruleBody(/\.virtual-pill,\s*\.source-pill\s*\{([^}]*)\}/);
  const sourceBackground = sourceRule.match(/background:\s*(#[0-9a-f]{6})/i)?.[1];
  const sourceColorToken = sourceRule.match(/color:\s*var\(--([^)]+)\)/)?.[1];
  const sourceColor = sourceColorToken
    ? styles.match(new RegExp(`--${sourceColorToken}:\\s*(#[0-9a-f]{6})`, "i"))?.[1]
    : undefined;
  assert.ok(sourceBackground);
  assert.ok(sourceColor);
  assert.ok(contrastRatio(sourceColor, sourceBackground) >= 4.5);

  assert.match(
    styles,
    /\.mood-control input\[type="range"\] \{[^}]*height: 24px;/,
  );
  assert.match(
    styles,
    /\.mood-control input\[type="range"\],\s*\.body-slider input \{\s*min-height: 44px;/,
  );
});

test("rejects anonymous reads and writes to private wardrobe APIs", async () => {
  const worker = await loadWorker();
  const env = {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  for (const [path, method] of [
    ["/api/wardrobe", "GET"],
    ["/api/wardrobe", "POST"],
    ["/api/wardrobe?id=w-test", "DELETE"],
    ["/api/wardrobe?scope=all", "DELETE"],
    ["/api/profile", "GET"],
    ["/api/profile", "PUT"],
    ["/api/profile", "DELETE"],
    ["/api/personal-data", "DELETE"],
    ["/api/wardrobe/image?id=w-test", "GET"],
  ]) {
    const response = await worker.fetch(
      new Request(`https://public.example${path}`, { method }),
      env,
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 401, path);
  }

  const staleSignedOutPage = await worker.fetch(
    new Request("https://public.example/api/profile", {
      headers: { "x-songsong-expected-owner": "a".repeat(64) },
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(staleSignedOutPage.status, 409);
  assert.equal(staleSignedOutPage.headers.get("x-songsong-session-status"), "changed");
});

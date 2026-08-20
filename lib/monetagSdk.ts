/**
 * Monetag's SDK exposes a global function named `show_<zoneId>` once the
 * zone's <script> embed tag has loaded. Loading the same zone's script twice
 * is one of the documented common mistakes, so we track loaded zones and
 * dedupe by a stable script id.
 */
const loadedZones = new Set<string>();

export function loadMonetagZoneScript(zoneId: string, scriptHtml: string): Promise<void> {
  if (loadedZones.has(zoneId)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const containerId = `monetag-zone-${zoneId}`;
    if (document.getElementById(containerId)) {
      loadedZones.add(zoneId);
      resolve();
      return;
    }

    // scriptHtml is the raw embed snippet pasted by the admin from the Monetag
    // dashboard for this zone (usually a single <script src="..."> tag).
    const container = document.createElement("div");
    container.id = containerId;
    container.style.display = "none";
    container.innerHTML = scriptHtml;
    document.body.appendChild(container);

    const scriptEl = container.querySelector("script");
    if (!scriptEl) {
      // Inline script with no src — innerHTML already executed it synchronously
      loadedZones.add(zoneId);
      resolve();
      return;
    }

    if (scriptEl.src) {
      // innerHTML doesn't execute <script src="..."> tags, so re-create it properly
      const s = document.createElement("script");
      s.src = scriptEl.src;
      s.async = true;
      s.onload = () => {
        loadedZones.add(zoneId);
        resolve();
      };
      s.onerror = () => reject(new Error("monetag_script_failed_to_load"));
      scriptEl.remove();
      container.appendChild(s);
    } else {
      loadedZones.add(zoneId);
      resolve();
    }
  });
}

/**
 * Preload + show chain exactly as recommended in Monetag's docs:
 *   show_XXX({ type: 'preload', ymid }).then(() => show_XXX({ ymid }))
 * `ymid` must be our own requestId so the postback can be matched back to
 * the correct TaskCompletion row server-side.
 */
export function showMonetagRewardedAd(zoneId: string, ymid: string): Promise<void> {
  const fn = (window as any)[`show_${zoneId}`];
  if (typeof fn !== "function") {
    return Promise.reject(new Error("monetag_sdk_not_ready"));
  }
  return fn({ type: "preload", ymid }).then(() => fn({ ymid }));
}

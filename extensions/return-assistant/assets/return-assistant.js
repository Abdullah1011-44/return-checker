(() => {
  const DEFAULT_PROXY_BASE = "/apps/return-assistant";
  const ALLOWED_MODES = new Set(["inline", "floating"]);
  const ALLOWED_EVENTS = new Set([
    "launcher_opened",
    "launcher_closed",
    "inline_viewed",
  ]);

  function setTextContent(element, value) {
    if (!element || value == null) {
      return;
    }

    element.textContent = String(value);
  }

  function readProxyBase(mount) {
    const configured = mount.dataset.proxyBase;
    if (typeof configured === "string" && configured.trim()) {
      return configured.trim();
    }

    return DEFAULT_PROXY_BASE;
  }

  function readMode(mount) {
    const mode = mount.dataset.mode;
    return ALLOWED_MODES.has(mode) ? mode : "inline";
  }

  function applyAccentColor(mount) {
    const accent = mount.dataset.accentColor;
    if (!accent) {
      return;
    }

    mount.style.setProperty("--rr-accent-color", accent);
  }

  async function fetchBootstrap(proxyBase) {
    try {
      const response = await fetch(proxyBase, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        credentials: "same-origin",
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (!data || data.ok !== true || data.enabled !== true) {
        return null;
      }

      return data;
    } catch (_error) {
      return null;
    }
  }

  function applyBootstrapCopy(mount, bootstrap) {
    if (!bootstrap?.copy) {
      return;
    }

    const titleEl = mount.querySelector("[data-rr-return-assistant-title]");
    const greetingEl = mount.querySelector(
      "[data-rr-return-assistant-greeting]",
    );
    const launcherTextEl = mount.querySelector(
      "[data-rr-return-assistant-launcher-text]",
    );

    if (bootstrap.copy.title) {
      setTextContent(titleEl, bootstrap.copy.title);
    }

    if (bootstrap.copy.greeting) {
      setTextContent(greetingEl, bootstrap.copy.greeting);
    }

    if (launcherTextEl && mount.dataset.buttonText) {
      setTextContent(launcherTextEl, mount.dataset.buttonText);
    }
  }

  function sendEvent(mount, eventName) {
    if (!ALLOWED_EVENTS.has(eventName)) {
      return;
    }

    const mode = readMode(mount);
    const proxyBase = readProxyBase(mount);

    try {
      const payload = {
        event: eventName,
        mode,
        timestamp: new Date().toISOString(),
      };

      fetch(proxyBase, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch (_error) {
      // Never break the storefront theme.
    }
  }

  function setPanelOpen(mount, isOpen) {
    const panel = mount.querySelector("[data-rr-return-assistant-panel]");
    const launcher = mount.querySelector("[data-rr-return-assistant-launcher]");

    if (!panel) {
      return;
    }

    panel.classList.toggle("rr-return-assistant__panel--hidden", !isOpen);
    panel.hidden = !isOpen;
    panel.setAttribute("aria-hidden", isOpen ? "false" : "true");

    if (launcher) {
      launcher.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }

    if (isOpen) {
      sendEvent(mount, "launcher_opened");
      return;
    }

    sendEvent(mount, "launcher_closed");
  }

  function bindFloatingInteractions(mount) {
    const launcher = mount.querySelector("[data-rr-return-assistant-launcher]");
    const closeButton = mount.querySelector("[data-rr-return-assistant-close]");

    if (launcher) {
      launcher.addEventListener("click", () => {
        const panel = mount.querySelector("[data-rr-return-assistant-panel]");
        const isCurrentlyOpen = panel ? !panel.hidden : false;
        setPanelOpen(mount, !isCurrentlyOpen);
      });
    }

    if (closeButton) {
      closeButton.addEventListener("click", () => {
        setPanelOpen(mount, false);
      });
    }
  }

  function bindInlineInteractions(mount) {
    const trigger = mount.querySelector("[data-rr-return-assistant-trigger]");
    if (!trigger) {
      return;
    }

    trigger.addEventListener("click", () => {
      // Inline mode keeps the fallback card visible for now.
    });
  }

  async function initializeMount(mount) {
    try {
      applyAccentColor(mount);

      const proxyBase = readProxyBase(mount);
      const mode = readMode(mount);
      const bootstrap = await fetchBootstrap(proxyBase);

      if (bootstrap) {
        applyBootstrapCopy(mount, bootstrap);
      }

      if (mode === "floating") {
        bindFloatingInteractions(mount);
        return;
      }

      bindInlineInteractions(mount);

      if (bootstrap) {
        sendEvent(mount, "inline_viewed");
      }
    } catch (_error) {
      // Never break the storefront theme.
    }
  }

  function initializeReturnAssistant() {
    try {
      const mounts = document.querySelectorAll("[data-rr-return-assistant]");
      for (const mount of mounts) {
        initializeMount(mount);
      }
    } catch (_error) {
      // Never break the storefront theme.
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeReturnAssistant);
  } else {
    initializeReturnAssistant();
  }
})();

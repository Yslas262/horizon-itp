import { Component } from '@theme/component';
import { debounce, onDocumentLoaded, setHeaderMenuStyle } from '@theme/utilities';
import { MegaMenuHoverEvent } from '@theme/events';

/** @type {number} Delay before closing dropdown (ms) — prevents accidental close */
const DROPDOWN_CLOSE_DELAY_MS = 220;

/**
 * A custom element that manages a header menu.
 *
 * @typedef {Object} State
 * @property {HTMLElement | null} activeItem - The currently active menu item.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} overflowMenu - The overflow menu.
 * @property {HTMLElement[]} [submenu] - The submenu in each respective menu item.
 *
 * @extends {Component<Refs>}
 */
class HeaderMenu extends Component {
  requiredRefs = ['overflowMenu'];

  /**
   * @type {MutationObserver | null}
   */
  #submenuMutationObserver = null;

  /**
   * @type {ReturnType<typeof setTimeout> | null}
   */
  #closeTimer = null;

  /**
   * @type {AbortController | null}
   */
  #dropdownAbort = null;

  connectedCallback() {
    super.connectedCallback();

    onDocumentLoaded(this.#preloadImages);
    window.addEventListener('resize', this.#resizeListener);
    this.overflowMenu?.addEventListener('pointerleave', this.#overflowSubmenuListener);
    document.addEventListener('focusin', this.#handleFocusIn);
    this.#bindPremiumDropdowns();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.#resizeListener);
    this.overflowMenu?.removeEventListener('pointerleave', this.#overflowSubmenuListener);
    document.removeEventListener('focusin', this.#handleFocusIn);
    this.#dropdownAbort?.abort();
    this.#dropdownAbort = null;
    this.#cancelScheduledClose();
    this.#cleanupMutationObserver();
  }

  get #isTextDropdownMode() {
    return this.dataset.dropdownMode === 'text';
  }

  /**
   * Stable hover: pointer stays on trigger, bridge, panel, or flyout.
   */
  #bindPremiumDropdowns() {
    this.#dropdownAbort?.abort();
    if (!this.#isTextDropdownMode) return;

    this.#dropdownAbort = new AbortController();
    const { signal } = this.#dropdownAbort;

    this.querySelectorAll('[data-menu-dropdown]').forEach((dropdown) => {
      dropdown.addEventListener(
        'pointerenter',
        () => {
          this.#cancelScheduledClose();
          const trigger = dropdown.querySelector('[ref="menuitem"]');
          if (trigger instanceof HTMLElement) {
            this.activate({ target: trigger });
          }
        },
        { signal }
      );

      dropdown.addEventListener(
        'pointerleave',
        (event) => {
          if (event.relatedTarget instanceof Node && dropdown.contains(event.relatedTarget)) return;
          this.#scheduleClose();
        },
        { signal }
      );

      dropdown.addEventListener(
        'focusin',
        () => {
          this.#cancelScheduledClose();
          const trigger = dropdown.querySelector('[ref="menuitem"]');
          if (trigger instanceof HTMLElement) {
            this.activate({ target: trigger });
          }
        },
        { signal }
      );

      dropdown.addEventListener(
        'focusout',
        (event) => {
          if (event.relatedTarget instanceof Node && dropdown.contains(event.relatedTarget)) return;
          this.#scheduleClose();
        },
        { signal }
      );
    });
  }

  #cancelScheduledClose() {
    if (this.#closeTimer) {
      clearTimeout(this.#closeTimer);
      this.#closeTimer = null;
    }
  }

  #scheduleClose() {
    this.#cancelScheduledClose();
    this.#closeTimer = setTimeout(() => {
      this.#closeTimer = null;
      this.#deactivate();
    }, DROPDOWN_CLOSE_DELAY_MS);
  }

  /**
   * Keyboard support for dropdown submenus (Escape, ArrowDown into panel).
   * @param {KeyboardEvent} event
   */
  handleKeydown = (event) => {
    if (!(event.target instanceof Element)) return;

    if (event.key === 'Escape') {
      if (!this.#state.activeItem) return;
      event.preventDefault();
      this.#cancelScheduledClose();
      this.#deactivate();
      this.#state.activeItem.focus();
      return;
    }

    const menuitem = event.target.closest('[ref="menuitem"]');
    if (!(menuitem instanceof HTMLElement) || menuitem.getAttribute('aria-haspopup') !== 'true') return;

    if (event.key === 'ArrowDown' || (event.key === ' ' && event.target === menuitem)) {
      event.preventDefault();
      this.#cancelScheduledClose();
      this.activate(event);
      const submenu = findSubmenu(menuitem);
      const firstLink = submenu?.querySelector('.menu-dropdown__link[href], a[href]');
      if (firstLink instanceof HTMLElement) {
        firstLink.focus();
      }
    }
  };

  /**
   * Close submenu when focus leaves the header menu entirely.
   * @param {FocusEvent} event
   */
  #handleFocusIn = (event) => {
    if (!(event.target instanceof Node)) return;
    if (this.contains(event.target)) return;
    if (this.overflowMenu?.contains(event.target)) return;

    if (this.#isTextDropdownMode) {
      this.#scheduleClose();
    } else {
      this.#deactivate();
    }
  };

  /**
   * Debounced resize event listener to recalculate menu style
   */
  #resizeListener = debounce(() => {
    setHeaderMenuStyle();
    this.#bindPremiumDropdowns();
  }, 100);

  #overflowSubmenuListener = () => {
    if (this.#isTextDropdownMode) {
      this.#scheduleClose();
    } else {
      this.#deactivate();
    }
  };

  /**
   * @type {State}
   */
  #state = {
    activeItem: null,
  };

  /**
   * Get the overflow menu
   */
  get overflowMenu() {
    return /** @type {HTMLElement | null} */ (this.refs.overflowMenu?.shadowRoot?.querySelector('[part="overflow"]'));
  }

  /**
   * Whether the overflow list is hovered
   * @returns {boolean}
   */
  get overflowListHovered() {
    return this.refs.overflowMenu?.shadowRoot?.querySelector('[part="overflow-list"]')?.matches(':hover') ?? false;
  }

  get headerComponent() {
    return /** @type {HTMLElement | null} */ (this.closest('header-component'));
  }

  /**
   * Activate the selected menu item immediately
   * @param {PointerEvent | FocusEvent | { target: Element }} event
   */
  activate = (event) => {
    this.dispatchEvent(new MegaMenuHoverEvent());

    if (!(event.target instanceof Element) || !this.headerComponent) return;

    let item = findMenuItem(event.target);

    if (!item || item == this.#state.activeItem) return;

    this.#cancelScheduledClose();

    const isDefaultSlot = event.target.slot === '';
    const isTextDropdown = this.#isTextDropdownMode && item.closest('[data-menu-dropdown]');

    this.dataset.overflowExpanded = (!isDefaultSlot).toString();

    const previouslyActiveItem = this.#state.activeItem;

    if (previouslyActiveItem) {
      previouslyActiveItem.ariaExpanded = 'false';
    }

    this.#state.activeItem = item;
    this.ariaExpanded = 'true';
    item.ariaExpanded = 'true';

    if (isTextDropdown) {
      this.headerComponent.style.setProperty('--submenu-height', '0px');
      this.#setFullOpenHeaderHeight(0);
      this.style.setProperty('--submenu-opacity', '0');
      const panel = findSubmenu(item);
      if (panel) {
        panel.dataset.active = '';
      }
      return;
    }

    let submenu = findSubmenu(item);
    const hasSubmenu = Boolean(submenu);

    if (!hasSubmenu && !isDefaultSlot) {
      submenu = this.overflowMenu;
    }

    if (submenu) {
      submenu.dataset.active = '';

      this.#cleanupMutationObserver();

      this.#submenuMutationObserver = new MutationObserver(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (submenu.offsetHeight > 0) {
              this.headerComponent?.style.setProperty('--submenu-height', `${submenu.offsetHeight}px`);
              this.#cleanupMutationObserver();
            }
          });
        });
      });
      this.#submenuMutationObserver.observe(submenu, { childList: true, subtree: true });

      setTimeout(() => {
        this.#cleanupMutationObserver();
      }, 500);
    }

    let finalHeight = submenu?.offsetHeight || 0;

    if (!isDefaultSlot) {
      const overflowListHeight = this.#getOverflowListLinksHeight();
      if (hasSubmenu) {
        const overflowHeight = this.overflowMenu?.offsetHeight || 0;
        finalHeight = Math.max(overflowHeight, overflowListHeight);
      } else {
        finalHeight = overflowListHeight;
      }
    }

    if (!submenu) {
      finalHeight = 0;
    }

    this.headerComponent.style.setProperty('--submenu-height', `${finalHeight}px`);
    this.#setFullOpenHeaderHeight(finalHeight);
    this.style.setProperty('--submenu-opacity', '1');
  };

  /**
   * Deactivate the active item (mega menu — immediate with guards).
   * @param {PointerEvent | FocusEvent} event
   */
  deactivate(event) {
    if (this.#isTextDropdownMode) return;

    if (!(event.target instanceof Element)) return;

    const menu = findSubmenu(this.#state.activeItem);
    const isMovingWithinMenu = event.relatedTarget instanceof Node && menu?.contains(document.activeElement);
    const isMovingToSubmenu =
      event.relatedTarget instanceof Node && event.type === 'blur' && menu?.contains(event.relatedTarget);
    const isMovingToOverflowMenu =
      event.relatedTarget instanceof Node && event.relatedTarget.parentElement?.matches('[slot="overflow"]');

    if (isMovingWithinMenu || isMovingToOverflowMenu || isMovingToSubmenu) return;

    this.#deactivate();
  }

  /**
   * Deactivate the active item
   * @param {HTMLElement | null} [item]
   */
  #deactivate = (item = this.#state.activeItem) => {
    if (!item || item != this.#state.activeItem) return;

    if (this.overflowListHovered || this.overflowMenu?.matches(':hover')) return;

    const submenu = findSubmenu(item);
    const isTextDropdown = this.#isTextDropdownMode && item.closest('[data-menu-dropdown]');

    this.headerComponent?.style.setProperty('--submenu-height', '0px');
    this.#setFullOpenHeaderHeight(0);
    this.style.setProperty('--submenu-opacity', '0');
    this.dataset.overflowExpanded = 'false';

    this.#state.activeItem = null;
    this.ariaExpanded = 'false';
    item.ariaExpanded = 'false';

    if (submenu) {
      delete submenu.dataset.active;
    }

    if (isTextDropdown) {
      return;
    }
  };

  #getOverflowListLinksHeight() {
    const slottedMenuLinks = this.overflowMenu?.querySelector('slot')?.assignedElements();
    if (!slottedMenuLinks) return this.overflowMenu?.offsetHeight || 0;

    /**
     * @param {(submenu: HTMLElement) => void} cb
     */
    const mapSubmenus = (cb) => {
      slottedMenuLinks.forEach((link) => {
        const submenu = /** @type {HTMLElement | null} */ (link.querySelector('[ref="submenu[]"]'));
        if (submenu) {
          cb(submenu);
        }
      });
    };

    mapSubmenus((submenu) => {
      submenu.style.setProperty('display', 'none');
    });
    const height = this.overflowMenu?.offsetHeight || 0;
    mapSubmenus((submenu) => {
      submenu.style.removeProperty('display');
    });
    return height;
  }

  /**
   * Calculate and set the full open header height. If the submenu is not open, the full open header height is 0.
   * @param {number} submenuHeight
   */
  #setFullOpenHeaderHeight(submenuHeight) {
    if (!this.headerComponent) return;

    const isOverlapSituation = this.headerComponent.hasAttribute('data-submenu-overlap-bottom-row');

    const headerVisibleHeight =
      isOverlapSituation && this.headerComponent.offsetHeight > 0
        ? /** @type {HTMLElement | null} */ (this.headerComponent.querySelector('.header__row--top'))?.offsetHeight ?? 0
        : this.headerComponent.offsetHeight;

    const nothingToOpen = submenuHeight === 0;
    const fullOpenHeaderHeight = nothingToOpen ? 0 : submenuHeight + (headerVisibleHeight ?? 0);

    this.headerComponent?.style.setProperty('--full-open-header-height', `${fullOpenHeaderHeight}px`);
  }

  /**
   * Preload images that are set to load lazily.
   */
  #preloadImages = () => {
    const images = this.querySelectorAll('img[loading="lazy"]');
    images?.forEach((image) => image.removeAttribute('loading'));
  };

  #cleanupMutationObserver() {
    this.#submenuMutationObserver?.disconnect();
    this.#submenuMutationObserver = null;
  }

  updatedCallback() {
    super.updatedCallback();
    this.#bindPremiumDropdowns();
  }
}

if (!customElements.get('header-menu')) {
  customElements.define('header-menu', HeaderMenu);
}

/**
 * Find the closest menu item.
 * @param {Element | null | undefined} element
 * @returns {HTMLElement | null}
 */
function findMenuItem(element) {
  if (!(element instanceof Element)) return null;

  if (element?.matches('[slot="more"')) {
    return findMenuItem(element.parentElement?.querySelector('[slot="overflow"]'));
  }

  const item = element.closest('[ref="menuitem"]');
  return item instanceof HTMLElement ? item : null;
}

/**
 * Find the closest submenu panel.
 * @param {Element | null | undefined} element
 * @returns {HTMLElement | null}
 */
function findSubmenu(element) {
  if (!(element instanceof Element)) return null;

  const root = element.closest('[data-menu-dropdown], .menu-list__list-item');
  const submenu = root?.querySelector('[ref="submenu[]"], .menu-dropdown__panel, .menu-list__submenu');
  return submenu instanceof HTMLElement ? submenu : null;
}

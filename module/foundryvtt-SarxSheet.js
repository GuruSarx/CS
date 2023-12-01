// SPDX-FileCopyrightText: 2023 Andrew Krigline

/**
 * Extend the basic ActorSheet with some customizations to use our own templates and styles
 */
//eslint-disable-next-line no-undef
class CompactBeyond5eSheet extends dnd5e.applications.actor.ActorSheet5eCharacter {
  constructor() {
    super(...arguments);
    this._debouncedSearchFilter = foundry.utils.debounce(this._handleSearchFilter, 200);
  }
  get template() {
    if (
      !game.user?.isGM &&
      this.actor.limited &&
      !game.settings.get(CompactBeyond5e.MODULE_ID, CompactBeyond5e.SETTINGS.expandedLimited)
    ) {
      return `modules/${CompactBeyond5e.MODULE_ID}/templates/character-sheet-ltd.hbs`;
    }

    return `modules/${CompactBeyond5e.MODULE_ID}/templates/character-sheet.hbs`;
  }

  static get defaultOptions() {
    const options = super.defaultOptions;

    // inject our own css class and filter options
    mergeObject(options, {
      classes: [...options.classes, 'cb5es'],
      scrollY: [...options.scrollY, '.sheet-sidebar'],
      height: 680,
      filters: [
        {
          inputSelector: '.spellbook input.filter',
          contentSelector: '.spellbook .inventory-list',
        },
        {
          inputSelector: '.inventory input.filter',
          contentSelector: '.inventory .inventory-list',
        },
        {
          inputSelector: '.features input.filter',
          contentSelector: '.features .inventory-list',
        },
      ],
      // template: `modules/${CompactBeyond5e.MODULE_ID}/templates/character-sheet.hbs`,
    });

    return options;
  }

  _handleSearchFilter(event, query, rgx, html) {
    const itemRows = html.querySelectorAll('.item-list > .item');
    //eslint-disable-next-line no-undef
    // log(false, 'onSearchFilter firing', {
    //   query,
    //   rgx,
    //   html,
    //   itemRows,
    // });
    for (let li of itemRows) {
      if (!query) {
        li.classList.remove('hidden');
        continue;
      }
      const title = li.querySelector('.item-name')?.textContent;
      if (!title) {
        continue;
      }
      const match = rgx.test(SearchFilter.cleanQuery(title));
      li.classList.toggle('hidden', !match);
    }
  }

  /** @override */
  _onSearchFilter(...args) {
    this._debouncedSearchFilter(...args);
  }

  /**
   * Inject the actions list into the actions tab before the render cycle completes
   */
  async _renderInner(...args) {
    const html = await super._renderInner(...args);
    const actionsListApi = game.modules.get('character-actions-list-5e')?.api;

    try {
      const actionsTab = html.find('.actions');

      const actionsTabHtml = await actionsListApi?.renderActionsList(this.actor);

      actionsTab.html(actionsTabHtml);
    } catch (e) {
      CompactBeyond5e.log(true, e);
    }

    return html;
  }

  /**
   * Method to calculate the spell attack modifier
   */
  _getSpellAttackMod() {
    const { abilities, attributes, bonuses } = this.actor.system;

    // calculate the spell attack modifier
    let spellAttackModFormula = [
      new Intl.NumberFormat('en-US', {
        signDisplay: 'exceptZero',
      })
        .format((abilities[attributes.spellcasting || 'int']?.mod ?? 0) + attributes.prof)
        .toString(),
    ];

    // apply the bonuses if they are equivalent
    if (bonuses.msak.attack === bonuses.rsak.attack) {
      spellAttackModFormula.push(bonuses.msak.attack);
    } else if (!!bonuses.msak.attack && !!bonuses.rsak.attack) {
      const formulaA = new Roll(bonuses.msak.attack);
      const formulaB = new Roll(bonuses.rsak.attack);

      // apply the lesser deterministic bonus
      if (formulaA.isDeterministic && formulaB.isDeterministic) {
        spellAttackModFormula.push(
          Math.min(formulaA.evaluate({ async: false }).total, formulaB.evaluate({ async: false }.total))
        );
      }
    }

    return spellAttackModFormula.length === 1
      ? spellAttackModFormula[0]
      : //eslint-disable-next-line no-undef
        dnd5e.dice.simplifyRollFormula(spellAttackModFormula.join(' + '));
  }

  /**
   * Extend and override the sheet data
   */
  async getData() {
    const sheetData = await super.getData();

    const { abilities, attributes, bonuses, details } = this.actor.system;

    const lockSheetsEnabled = game.settings.get(CompactBeyond5e.MODULE_ID, CompactBeyond5e.SETTINGS.lockSheets);

    const options = {
      locked: lockSheetsEnabled ? CompactBeyond5e.isLocked(this.actor._id) ?? true : false,
    };

    if (lockSheetsEnabled) {
      CompactBeyond5e.bindLock(this.actor._id);
    }

    sheetData.options = options;

    sheetData.moduleFilePath = `modules/${CompactBeyond5e.MODULE_ID}/`;
    sheetData.nextLevel = details.level + 1;

    sheetData.spellAttackMod = this._getSpellAttackMod();
    sheetData.spellSaveDcWithMods = attributes.spelldc + bonuses.spell.dc;

    // simplify the formula and apply if it is a string
    if (typeof sheetData.spellSaveDcWithMods === 'string') {
      //eslint-disable-next-line no-undef
      sheetData.spellSaveDcWithMods = dnd5e.dice.simplifyRollFormula(sheetData.spellSaveDcWithMods);
    }

    CompactBeyond5e.log(false, {
      abilities: abilities,
      ability: abilities[attributes.spellcasting || 'int'],
      mod: abilities[attributes.spellcasting || 'int']?.mod ?? 0,
      prof: attributes.prof,
      spellAttackMod: sheetData.spellAttackMod,
      options: options,
    });

    return sheetData;
  }
}

// SPDX-FileCopyrightText: 2023 Andrew Krigline

class CompactBeyond5e {
  static MODULE_ID = 'compact-beyond-5e-sheet';
  static MODULE_TITLE = 'Compact DnDBeyond 5e Character Sheet';
  static PLAYER_SHEETS = [];

  static SETTINGS = {
    expandedLimited: 'expanded-limited',
    darkMode: 'dark-mode',
    // displayPassivePerception: 'display-passive-per',
    // displayPassiveInsight: 'display-passive-ins',
    // displayPassiveInvestigation: 'display-passive-inv',
    // displayPassiveStealth: 'display-passive-ste',
    showSpellSlotBubbles: 'show-spell-slot-bubbles',
    showFullCurrencyNames: 'show-full-currency-names',
    lockSheets: 'lock-sheets',
  };

  /**
   * Log helper that uses devMode to avoid spamming the console in prod
   * @param {boolean} force
   * @param  {...any} args
   */
  static log(force, ...args) {
    const shouldLog = force || game.modules.get('_dev-mode')?.api?.getPackageDebugValue(this.MODULE_ID);

    if (shouldLog) {
      console.log(this.MODULE_ID, '|', ...args);
    }
  }

  static bindLock(actorId, status = true) {
    const hasKey = this.PLAYER_SHEETS.some((el) => el.key === actorId);

    if (!hasKey) {
      this.PLAYER_SHEETS.push({ key: actorId, status: status });
    }
  }

  static isLocked(actorId) {
    const character = this.PLAYER_SHEETS.find((el) => el.key === actorId);
    return character?.status ?? null;
  }

  static toggleLock(actorId) {
    const character = this.PLAYER_SHEETS.find((el) => el.key === actorId);
    character.status = !character.status;
  }

  static registerSettings() {
    game.settings.register(this.MODULE_ID, this.SETTINGS.expandedLimited, {
      name: 'CB5ES.settings.expandedLimited.Label',
      default: false,
      type: Boolean,
      scope: 'world',
      config: true,
      hint: 'CB5ES.settings.expandedLimited.Hint',
    });

    game.settings.register(this.MODULE_ID, this.SETTINGS.lockSheets, {
      name: 'CB5ES.settings.lockSheets.Label',
      default: false,
      type: Boolean,
      scope: 'world',
      config: true,
      hint: 'CB5ES.settings.lockSheets.Hint',
    });

    const darkModeClass = 'cb5es-dark-mode';
    game.settings.register(this.MODULE_ID, this.SETTINGS.darkMode, {
      name: 'CB5ES.settings.darkMode.Label',
      type: String,
      scope: 'client',
      config: true,
      default: 'default',
      hint: 'CB5ES.settings.darkMode.Hint',
      choices: {
        default: 'CB5ES.settings.darkMode.default',
        dark: 'CB5ES.settings.darkMode.dark',
      },
      onChange: (data) => {
        data === 'dark'
          ? document.querySelector('html').classList.add(darkModeClass)
          : document.querySelector('html').classList.remove(darkModeClass);
      },
    });
    const colourScheme = game.settings.get(this.MODULE_ID, this.SETTINGS.darkMode);
    colourScheme === 'dark' && document.querySelector('html').classList.add(darkModeClass);

    game.settings.register(this.MODULE_ID, this.SETTINGS.showSpellSlotBubbles, {
      name: 'CB5ES.settings.showSpellSlotBubbles.Label',
      default: true,
      type: Boolean,
      scope: 'client',
      config: true,
      hint: 'CB5ES.settings.showSpellSlotBubbles.Hint',
    });

    game.settings.register(this.MODULE_ID, this.SETTINGS.showFullCurrencyNames, {
      name: 'CB5ES.settings.showFullCurrencyNames.Label',
      default: false,
      type: Boolean,
      scope: 'client',
      config: true,
      hint: 'CB5ES.settings.showFullCurrencyNames.Hint',
    });

    // game.settings.register(this.MODULE_ID, this.SETTINGS.displayPassivePerception, {
    //   name: 'CB5ES.settings.displayPassives.prc.Label',
    //   default: false,
    //   type: Boolean,
    //   scope: 'world',
    //   config: true,
    // });
    // game.settings.register(this.MODULE_ID, this.SETTINGS.displayPassiveInsight, {
    //   name: 'CB5ES.settings.displayPassives.ins.Label',
    //   default: false,
    //   type: Boolean,
    //   scope: 'world',
    //   config: true,
    // });
    // game.settings.register(this.MODULE_ID, this.SETTINGS.displayPassiveInvestigation, {
    //   name: 'CB5ES.settings.displayPassives.inv.Label',
    //   default: false,
    //   type: Boolean,
    //   scope: 'world',
    //   config: true,
    // });
    // game.settings.register(this.MODULE_ID, this.SETTINGS.displayPassiveStealth, {
    //   name: 'CB5ES.settings.displayPassives.ste.Label',
    //   default: false,
    //   type: Boolean,
    //   scope: 'world',
    //   config: true,
    // });
  }

  // Add currency abbreviations to actor
  // eslint-disable-next-line no-unused-vars
  static addCurrencyAbbreviations(app, html, data) {
    const currencies = CONFIG.DND5E.currencies;
    const labels = html.find('.currency-abbreviation');
    for (let i in currencies) {
      let label = labels.filter(`.${i}`);
      if (game.settings.get(this.MODULE_ID, this.SETTINGS.showFullCurrencyNames)) {
        label.html(currencies[i].label);
      } else {
        label.html(currencies[i].abbreviation);
      }
    }
  }

  // Add Spell Slot Marker
  // eslint-disable-next-line no-unused-vars
  static spellSlotMarker(app, html, data) {
    if (!game.settings.get(this.MODULE_ID, this.SETTINGS.showSpellSlotBubbles)) {
      return;
    }

    let actor = app.actor;
    // let items = data.actor.items;
    let options = ['pact', 'spell1', 'spell2', 'spell3', 'spell4', 'spell5', 'spell6', 'spell7', 'spell8', 'spell9'];
    for (let o of options) {
      let max = html.find(`.spell-max[data-level=${o}]`);
      let name = max.closest('.spell-slots');
      let spellData = actor.system.spells[o];
      if (spellData.max === 0) {
        continue;
      }
      let contents = ``;
      for (let i = 1; i <= spellData.max; i++) {
        if (i <= spellData.value) {
          contents += `<span class="dot"></span>`;
        } else {
          contents += `<span class="dot empty"></span>`;
        }
      }
      name.before(`<div class="spellSlotMarker">${contents}</div>`);
    }

    html.find('.spellSlotMarker .dot').mouseenter((ev) => {
      const parentEl = ev.currentTarget.parentElement;
      const index = [...parentEl.children].indexOf(ev.currentTarget);
      const dots = parentEl.querySelectorAll('.dot');

      if (ev.currentTarget.classList.contains('empty')) {
        for (let i = 0; i < dots.length; i++) {
          if (i <= index) {
            dots[i].classList.contains('empty') ? dots[i].classList.add('change') : '';
          }
        }
      } else {
        for (let i = 0; i < dots.length; i++) {
          if (i >= index) {
            dots[i].classList.contains('empty') ? '' : dots[i].classList.add('change');
          }
        }
      }
    });

    html.find('.spellSlotMarker .dot').mouseleave((ev) => {
      const parentEl = ev.currentTarget.parentElement;
      $(parentEl).find('.dot').removeClass('change');
    });

    html.find('.spellSlotMarker .dot').click(async (ev) => {
      const index = [...ev.currentTarget.parentElement.children].indexOf(ev.currentTarget);
      const slots = $(ev.currentTarget).parents('.spell-level-slots');
      const spellLevel = slots.find('.spell-max').data('level');
      if (spellLevel) {
        let path = `data.spells.${spellLevel}.value`;
        if (ev.currentTarget.classList.contains('empty')) {
          await actor.update({
            [path]: index + 1,
          });
        } else {
          await actor.update({
            [path]: index,
          });
        }
      }
    });
  }

  static async preloadTemplates() {
    const templatePaths = [
      'assets/armor-class.hbs',
      'templates/character-sheet-ltd.hbs',
      'templates/character-sheet.hbs',
      'templates/parts/actor-features.hbs',
      'templates/parts/actor-inventory.hbs',
      'templates/parts/actor-spellbook.hbs',
      'templates/parts/actor-traits.hbs',
      'templates/parts/sheet-header.hbs',
      'templates/parts/sheet-sidebar.hbs',
    ];

    return loadTemplates(templatePaths.map((path) => `modules/${this.MODULE_ID}/${path}`));
  }

  /**
   * Initialize the module
   * Registers hooks and sheets
   */
  static init() {
    Handlebars.registerHelper('cb5es-isEmpty', foundry.utils.isEmpty);

    Actors.registerSheet('dnd5e', CompactBeyond5eSheet, {
      label: 'Compact D&D Beyond-like',
      makeDefault: false,
      types: ['character'],
    });

    Hooks.once('devModeReady', ({ registerPackageDebugFlag }) => {
      registerPackageDebugFlag(this.MODULE_ID);
    });

    Hooks.once('init', () => {
      this.log(true, `Initializing ${this.MODULE_ID}`);

      // Register custom module settings
      this.registerSettings();

      // Preload Handlebars templates
      this.preloadTemplates();
    });

    Hooks.on('renderCompactBeyond5eSheet', (app, html, data) => {
      this.spellSlotMarker(app, html, data);
      this.addCurrencyAbbreviations(app, html, data);

      if (game.settings.get(this.MODULE_ID, this.SETTINGS.lockSheets)) {
        // Make a header element and attach it to the window title.
        // Definitely not the most official way of doing things, but it works.
        this.bindLock(data.actor._id);
        const headerbtn = document.createElement('a');
        headerbtn.classList.add('control');
        headerbtn.innerText = this.isLocked(data.actor._id) ? 'Locked' : 'Unlocked';
        headerbtn.onclick = () => {
          this.toggleLock(data.actor._id);
          app.close();

          // This will wait 250 milliseconds to reopen the sheet.
          setTimeout(() => {
            app.render(true);
          }, 250);
        };

        html.find('.window-title')[0].after(headerbtn);
      }
    });
  }
}

CompactBeyond5e.init();

export { CompactBeyond5e };
//# sourceMappingURL=foundryvtt-compactBeyond5eSheet.js.map
